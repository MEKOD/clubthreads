import Fastify from "fastify";
import { db, checkDbHealth } from "./db";
import { getDailyMetrics, getTopRoutes } from "./services/analytics";
import { getNotificationListenerCount, getActiveUserIds } from "./services/notificationHub";
import { users } from "./db/schema";
import { inArray, sql } from "drizzle-orm";

export function createMonitoringServer(redis: {
  ping?: () => Promise<string>;
  hgetall: (key: string) => Promise<Record<string, string>>;
}) {
  const monitoring = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "warn" : "info",
    },
  });

  monitoring.get("/", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(`<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Underground Monitoring</title>
  <style>
    :root { color-scheme: dark; --bg:#0b1020; --card:#121a30; --muted:#8da0c9; --text:#eef3ff; --accent:#59d0ff; --danger:#ff6b6b; --ok:#43d17d; }
    * { box-sizing:border-box; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin:0; background:radial-gradient(circle at top, #16213e 0%, var(--bg) 55%); color:var(--text); }
    main { max-width:1200px; margin:0 auto; padding:24px; }
    h1 { margin:0 0 6px; font-size:28px; }
    p { color:var(--muted); margin:0; }
    .grid { display:grid; gap:14px; }
    .cards { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-top:18px; }
    .card { background:rgba(18,26,48,.92); border:1px solid rgba(255,255,255,.08); border-radius:16px; padding:16px; box-shadow:0 10px 30px rgba(0,0,0,.18); }
    .label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
    .value { font-size:28px; font-weight:700; margin-top:8px; }
    .sub { color:var(--muted); font-size:13px; margin-top:8px; }
    .status-ok { color: var(--ok); }
    .status-bad { color: var(--danger); }
    .active-badge { display:inline-block; padding:2px 8px; border-radius:4px; background:rgba(89,208,255,0.15); color:var(--accent); font-size:12px; margin:2px; }
    .two { grid-template-columns: 2fr 1fr; margin-top:14px; }
    table { width:100%; border-collapse:collapse; }
    th, td { text-align:left; padding:10px 0; border-bottom:1px solid rgba(255,255,255,.07); font-size:14px; }
    th { color:var(--muted); font-weight:600; }
    .bars { display:grid; gap:10px; margin-top:12px; }
    .bar-row { display:grid; gap:6px; }
    .bar-label { display:flex; justify-content:space-between; color:var(--muted); font-size:13px; }
    .bar-track { width:100%; height:10px; border-radius:999px; background:rgba(255,255,255,.08); overflow:hidden; }
    .bar-fill { height:100%; border-radius:999px; background:linear-gradient(90deg, var(--accent), #95f9c3); }
    @media (max-width: 900px) { .two { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>Monitoring</h1>
    <p>API, push ve urun akislarini tek yerden izle.</p>
    <div id="cards" class="grid cards"></div>
    <div class="grid two">
      <section class="card">
        <div class="label">Son 7 Gun Trafik</div>
        <div id="traffic" class="bars"></div>
      </section>
      <section class="card">
        <div class="label">Sistem Durumu</div>
        <table><tbody id="health"></tbody></table>
      </section>
    </div>
    <div class="grid two">
      <section class="card">
        <div class="label">En Yogun Route'lar</div>
        <table>
          <thead><tr><th>Route</th><th>Istek</th><th>Ort. ms</th><th>5xx</th></tr></thead>
          <tbody id="routes"></tbody>
        </table>
      </section>
      <section class="card">
        <div class="label">Aktif Kullanicilar</div>
        <div id="active-list" style="margin-top:12px; display:flex; flex-wrap:wrap;"></div>
      </section>
    </div>
  </main>
  <script>
    const fmt = new Intl.NumberFormat("tr-TR");
    function card(label, value, sub = "") {
      return '<section class="card"><div class="label">' + label + '</div><div class="value">' + value + '</div><div class="sub">' + sub + '</div></section>';
    }
    function statusCell(label, ok, detail) {
      return '<tr><td>' + label + '</td><td class="' + (ok ? 'status-ok' : 'status-bad') + '">' + (ok ? 'OK' : 'Sorun') + '</td><td>' + (detail ?? '') + '</td></tr>';
    }
    function bars(days) {
      const peak = Math.max(1, ...days.map(d => d.requests));
      return days.map(day => {
        const width = Math.max(4, Math.round((day.requests / peak) * 100));
        return '<div class="bar-row"><div class="bar-label"><span>' + day.date + '</span><span>' + fmt.format(day.requests) + ' istek</span></div><div class="bar-track"><div class="bar-fill" style="width:' + width + '%"></div></div></div>';
      }).join('');
    }
    async function refresh() {
      const res = await fetch('/summary');
      const data = await res.json();
      document.getElementById('cards').innerHTML = [
        card('Toplam User', fmt.format(data.totals.users), 'Toplam community: ' + fmt.format(data.totals.communities)),
        card('Toplam Post', fmt.format(data.totals.posts), 'Toplam bildirim: ' + fmt.format(data.totals.notifications)),
        card('Bugun Istek', fmt.format(data.today.requests), 'Ort latency: ' + fmt.format(data.today.avgLatencyMs) + ' ms'),
        card('Bugun 5xx', fmt.format(data.today.errors5xx), '4xx: ' + fmt.format(data.today.errors4xx)),
        card('Push Gonderim', fmt.format(data.today.pushSent), 'Fail: ' + fmt.format(data.today.pushFailed) + ' / Stale: ' + fmt.format(data.today.pushStale)),
        card('Canli Dinleyici', fmt.format(data.runtime.notificationListeners), 'Uptime: ' + fmt.format(data.runtime.uptimeSeconds) + ' sn'),
      ].join('');
      document.getElementById('traffic').innerHTML = bars(data.daily);
      document.getElementById('health').innerHTML = [
        statusCell('Database', data.health.db.ok, data.health.db.message),
        statusCell('Redis', data.health.redis.ok, data.health.redis.message),
        '<tr><td>RSS</td><td colspan="2">' + fmt.format(data.runtime.memoryRssMb) + ' MB</td></tr>',
        '<tr><td>Heap Used</td><td colspan="2">' + fmt.format(data.runtime.heapUsedMb) + ' MB</td></tr>',
      ].join('');
      document.getElementById('routes').innerHTML = data.topRoutes.map((route) =>
        '<tr><td>' + route.route + '</td><td>' + fmt.format(route.count) + '</td><td>' + fmt.format(route.avgMs) + '</td><td>' + fmt.format(route.errors5xx) + '</td></tr>'
      ).join('');
      
      const activeList = data.runtime.activeUsernames.length > 0 
        ? data.runtime.activeUsernames.map(u => '<span class="active-badge">' + u + '</span>').join('')
        : '<span style="color:var(--muted); font-size:13px;">Su an kimse aktif degil.</span>';
      document.getElementById('active-list').innerHTML = activeList;
    }
    refresh();
    setInterval(refresh, 30000);
  </script>
</body>
</html>`);
  });

  monitoring.get("/summary", async (_request, reply) => {
    const activeIds = getActiveUserIds();
    const [daily, topRoutes, totals, dbHealth, redisHealth, activeUsers] = await Promise.all([
      getDailyMetrics(redis, 7),
      getTopRoutes(redis, 1, 8),
      db.execute<{
        userCount: string;
        communityCount: string;
        postCount: string;
        notificationCount: string;
      }>(sql`
                SELECT
                  (SELECT COUNT(*) FROM users)::text AS "userCount",
                  (SELECT COUNT(*) FROM communities)::text AS "communityCount",
                  (SELECT COUNT(*) FROM posts)::text AS "postCount",
                  (SELECT COUNT(*) FROM notifications)::text AS "notificationCount"
            `),
      checkDbHealth().then(() => ({ ok: true, message: "SELECT 1" })).catch((error) => ({
        ok: false,
        message: error instanceof Error ? error.message : "DB check failed",
      })),
      redis.ping
        ? redis.ping()
          .then((message) => ({ ok: true, message }))
          .catch((error) => ({
            ok: false,
            message: error instanceof Error ? error.message : "Redis ping failed",
          }))
        : Promise.resolve({ ok: true, message: "PING unavailable" }),
      activeIds.length > 0
        ? db.select({ username: users.username }).from(users).where(inArray(users.id, activeIds))
        : Promise.resolve([]),
    ]);

    const totalsRow = totals.rows[0];
    const today = daily[daily.length - 1] ?? {
      date: new Date().toISOString().slice(0, 10),
      requests: 0,
      errors4xx: 0,
      errors5xx: 0,
      avgLatencyMs: 0,
      postsCreated: 0,
      followsCreated: 0,
      favsAdded: 0,
      registrations: 0,
      logins: 0,
      notificationsEmitted: 0,
      pushSent: 0,
      pushFailed: 0,
      pushStale: 0,
    };

    return reply.send({
      totals: {
        users: parseInt(totalsRow?.userCount ?? "0", 10),
        communities: parseInt(totalsRow?.communityCount ?? "0", 10),
        posts: parseInt(totalsRow?.postCount ?? "0", 10),
        notifications: parseInt(totalsRow?.notificationCount ?? "0", 10),
      },
      today,
      daily,
      topRoutes,
      runtime: {
        uptimeSeconds: Math.round(process.uptime()),
        memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        notificationListeners: getNotificationListenerCount(),
        activeUsernames: activeUsers.map(u => u.username),
      },
      health: {
        db: dbHealth,
        redis: redisHealth,
      },
    });
  });

  return monitoring;
}
