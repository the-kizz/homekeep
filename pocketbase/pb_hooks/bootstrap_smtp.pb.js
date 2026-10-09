/// <reference path="../pb_data/types.d.ts" />

onBootstrap((e) => {
  e.next(); // let PB finish booting, THEN inject settings

  const host = process.env.SMTP_HOST;
  const portStr = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !portStr || !user || !pass) {
    console.log("[smtp] env not set — SMTP disabled (password reset will no-op)");
    return;
  }

  const settings = $app.settings();
  settings.smtp.enabled = true;
  settings.smtp.host = host;
  settings.smtp.port = parseInt(portStr, 10);
  settings.smtp.username = user;
  settings.smtp.password = pass;
  settings.smtp.tls = process.env.SMTP_TLS !== "false";
  settings.smtp.authMethod = "PLAIN";
  settings.meta.senderAddress = process.env.SMTP_FROM || user;
  settings.meta.senderName = process.env.SMTP_FROM_NAME || "HomeKeep";

  $app.save(settings);
  console.log(`[smtp] configured for host=${host} port=${portStr} user=${user}`);
});
