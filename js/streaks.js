// ─── Streaks & Heatmap Module ─────────────────────────────────────────────────

const Streaks = (() => {

  function getHeatmapData(weeksBack = 26) {
    const { dailyScores } = Storage.getStreakData();
    const cells = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Start from `weeksBack` weeks ago, on Sunday
    const start = new Date(today);
    start.setDate(start.getDate() - (weeksBack * 7) - start.getDay());

    const cursor = new Date(start);
    while (cursor <= today) {
      const ds = cursor.toISOString().slice(0, 10);
      const score = dailyScores[ds] || null;
      cells.push({
        date: ds,
        score,
        level: score === null ? 0 : score < 30 ? 1 : score < 55 ? 2 : score < 75 ? 3 : 4,
        isFuture: cursor > today,
        isToday: ds === Storage.todayStr(),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return cells;
  }

  function renderHeatmap(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const cells = getHeatmapData(26);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }

    // Month labels
    const months = [];
    let lastMonth = -1;
    weeks.forEach((week, wi) => {
      const firstDay = week[0];
      const m = new Date(firstDay.date).getMonth();
      if (m !== lastMonth) {
        months.push({ wi, label: new Date(firstDay.date).toLocaleString('default', { month: 'short' }) });
        lastMonth = m;
      }
    });

    const CELL = 14;
    const GAP = 3;
    const LABEL_H = 22;
    const DAY_LABEL_W = 28;
    const W = weeks.length * (CELL + GAP) + DAY_LABEL_W;
    const H = 7 * (CELL + GAP) + LABEL_H;

    const isDark = document.documentElement.classList.contains('theme-dark');
    const levelColors = isDark
      ? ['#2a2723', '#5f4933', '#b67825', '#008d7a', '#00b89e']
      : ['#ece7dc', '#f8d7b5', '#f2b84b', '#00a68f', '#117c6e'];
    const labelColor = isDark ? '#b7ada2' : '#64748b';

    let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">`;

    // Month labels
    months.forEach(({ wi, label }) => {
      const x = DAY_LABEL_W + wi * (CELL + GAP);
      svg += `<text x="${x}" y="14" fill="${labelColor}" font-size="11" font-family="Inter,sans-serif">${label}</text>`;
    });

    // Day labels
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d, di) => {
      if (di % 2 === 1) {
        const y = LABEL_H + di * (CELL + GAP) + CELL - 2;
        svg += `<text x="0" y="${y}" fill="${labelColor}" font-size="10" font-family="Inter,sans-serif">${d}</text>`;
      }
    });

    // Cells
    weeks.forEach((week, wi) => {
      week.forEach((cell, di) => {
        const x = DAY_LABEL_W + wi * (CELL + GAP);
        const y = LABEL_H + di * (CELL + GAP);
        const color = cell.isFuture ? 'transparent' : levelColors[cell.level];
        const border = cell.isToday ? 'stroke="#ff5f57" stroke-width="2"' : '';
        const title = cell.score !== null ? `${cell.date}: Focus Score ${cell.score}` : cell.date;
        svg += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3" fill="${color}" ${border} opacity="${cell.isFuture ? 0 : 1}">
          <title>${title}</title>
        </rect>`;
      });
    });

    svg += '</svg>';
    container.innerHTML = svg;
  }

  function getWeeklyStats() {
    const sessions = Storage.Sessions.getAll().filter(s => s.completed);
    const now = Date.now();
    const thisWeekStart = now - 7 * 24 * 60 * 60 * 1000;
    const lastWeekStart = now - 14 * 24 * 60 * 60 * 1000;

    const thisWeek = sessions.filter(s => s.startTime >= thisWeekStart);
    const lastWeek = sessions.filter(s => s.startTime >= lastWeekStart && s.startTime < thisWeekStart);

    const avgScore = arr => arr.length ? Math.round(arr.reduce((a, s) => a + (s.focusScore || 0), 0) / arr.length) : 0;

    return {
      thisWeek: { count: thisWeek.length, avgScore: avgScore(thisWeek) },
      lastWeek: { count: lastWeek.length, avgScore: avgScore(lastWeek) },
      improvement: avgScore(thisWeek) - avgScore(lastWeek),
    };
  }

  function renderMiniBar(containerId) {
    // 7-day mini bar chart for dashboard
    const container = document.getElementById(containerId);
    if (!container) return;

    const { dailyScores } = Storage.getStreakData();
    const isDark = document.documentElement.classList.contains('theme-dark');
    const labelColor = isDark ? '#b7ada2' : '#64748b';
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      days.push({
        label: d.toLocaleDateString('default', { weekday: 'short' }),
        score: dailyScores[ds] || 0,
        date: ds,
      });
    }

    const maxScore = 100;
    const BAR_W = 28;
    const GAP = 6;
    const MAX_H = 80;
    const LABEL_H = 20;
    const W = days.length * (BAR_W + GAP);
    const H = MAX_H + LABEL_H;

    let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
    days.forEach((day, i) => {
      const barH = Math.max(4, (day.score / maxScore) * MAX_H);
      const x = i * (BAR_W + GAP);
      const y = MAX_H - barH;
      const isToday = day.date === Storage.todayStr();
      const fill = isToday
        ? 'url(#barGrad)'
        : day.score >= 70 ? '#00a68f99' : day.score >= 40 ? '#f2b84b99' : isDark ? '#fffaf21f' : '#211f1c22';
      svg += `
        <rect x="${x}" y="${y}" width="${BAR_W}" height="${barH}" rx="5" fill="${fill}"/>
        <text x="${x + BAR_W / 2}" y="${H}" text-anchor="middle" fill="${labelColor}" font-size="11" font-family="Inter,sans-serif">${day.label}</text>
      `;
    });
    svg += `<defs>
      <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ff5f57"/>
        <stop offset="100%" stop-color="#00a68f"/>
      </linearGradient>
    </defs></svg>`;
    container.innerHTML = svg;
  }

  return { getHeatmapData, renderHeatmap, getWeeklyStats, renderMiniBar };
})();

window.Streaks = Streaks;
