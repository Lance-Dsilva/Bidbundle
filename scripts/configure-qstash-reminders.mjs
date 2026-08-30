import { Client } from "@upstash/qstash";

const destinationOrigin = process.argv[2] ?? process.env.APP_URL;

if (!destinationOrigin) {
  throw new Error(
    "Pass the production origin, for example: npm run qstash:configure-reminders -- https://bundleen.com",
  );
}

if (!process.env.QSTASH_TOKEN) {
  throw new Error("QSTASH_TOKEN is required to configure the reminder schedule.");
}

const origin = new URL(destinationOrigin);
if (origin.protocol !== "https:") {
  throw new Error("The QStash reminder destination must use HTTPS.");
}

const destination = new URL("/api/jobs/reminders", origin).toString();
const scheduleId = "bundleen-reminder-worker";
const client = new Client({
  baseUrl: process.env.QSTASH_URL,
  token: process.env.QSTASH_TOKEN,
});

const result = await client.schedules.create({
  scheduleId,
  destination,
  cron: "*/5 * * * *",
  method: "POST",
  body: "{}",
  headers: { "Content-Type": "application/json" },
  retries: 3,
  timeout: 60,
  label: "bundleen-reminders",
});

console.log(
  `Configured QStash schedule ${result.scheduleId} to call ${destination} every five minutes.`,
);
