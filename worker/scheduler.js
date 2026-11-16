// platform.every() on Cloudflare: one Durable Object alarm, set for whichever job is due next. A job can say it
// isn't needed right now (no bot has a timer, no counts waiting), so an idle Opencord isn't woken for nothing.
export class Scheduler {
  constructor(current) {
    this.current = current; // () => the Durable Object's ctx
    this.jobs = [];
    this.alarmAt = undefined; // what we last set (undefined: not known yet)
  }

  add(ms, fn, { needed = () => true } = {}) {
    this.jobs.push({ ms, fn, needed, next: Date.now() + ms });
  }

  // The object was rebuilt: its alarm is whatever storage says.
  reset() {
    this.alarmAt = undefined;
  }

  // Runs whatever is due (called from the alarm), then sets the next alarm.
  async run() {
    const now = Date.now();
    for (const job of this.jobs) {
      if (job.next > now) continue;
      job.next = now + job.ms;
      if (!job.needed()) continue;
      try {
        await job.fn();
      } catch (err) {
        console.error('Scheduled job failed:', err);
      }
    }
    this.alarmAt = null;
    await this.arm();
  }

  // Makes sure an alarm is set for the next needed job (after each request, as what's needed can change).
  async arm() {
    const due = this.jobs.filter((j) => j.needed()).map((j) => j.next);
    if (!due.length) return;
    const next = Math.max(Math.min(...due), Date.now() + 1000);
    const storage = this.current().storage;
    if (this.alarmAt === undefined) this.alarmAt = await storage.getAlarm();
    if (this.alarmAt && this.alarmAt <= next) return;
    this.alarmAt = next;
    await storage.setAlarm(next);
  }
}
