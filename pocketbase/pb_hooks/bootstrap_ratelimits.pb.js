/// <reference path="../pb_data/types.d.ts" />

onBootstrap((e) => {
  e.next();

  const settings = $app.settings();
  settings.rateLimits.enabled = true;
  // Brute-force protection on login endpoint: 5 attempts / 60s per IP for unauthenticated users.
  settings.rateLimits.rules = [
    {
      label: "*:auth-with-password",
      duration: 60,
      maxRequests: 5,
      audience: "@guest",
    },
    // Generic conservative ceiling for unauthenticated endpoints.
    {
      label: "*",
      duration: 60,
      maxRequests: 300,
      audience: "@guest",
    },
  ];

  $app.save(settings);
  console.log("[ratelimits] enabled: 5/min on auth-with-password, 300/min guest ceiling");
});
