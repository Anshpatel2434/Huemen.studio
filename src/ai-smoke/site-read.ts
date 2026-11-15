/**
 * Reads real websites end to end, as onboarding does, and prints what was
 * found and how long it took. No model, no database: a check of the crawler
 * and the rules against live sites.
 *
 *   npm run smoke:site -- example.com another.com
 */
import { readSite } from "@/lib/integrations/site";
import { crawl, scriptOnly } from "@/lib/integrations/crawl";
import { extractDetails, profileFrom } from "@/lib/integrations/site-details";

async function one(raw: string) {
  const t0 = Date.now();
  const home = await readSite(raw);
  const t1 = Date.now();
  const read = await crawl(home.plan, { budgetMs: 20_000 });
  const t2 = Date.now();
  const d = { ...extractDetails(read.pages, { title: home.title, description: home.description }), scriptOnly: read.pages.filter((p) => scriptOnly(p.html)).length };
  const t3 = Date.now();
  const p = profileFrom(d);
  console.log(`\n=== ${home.url}  home ${t1 - t0} ms, ${read.pages.length} pages ${t2 - t1} ms (${read.skipped.length} skipped), rules ${t3 - t2} ms`);
  console.log("palette", home.palette.slice(0, 5).join(" "), "| fonts", home.fonts.slice(0, 2).join(", "), "| logo", home.logo);
  console.log("pages", d.pages.map((x) => `${x.kind}:${new URL(x.url).pathname}`).join("  "));
  console.log("profile", JSON.stringify(p, null, 1));
  console.log(`services ${d.services.length}:`, d.services.slice(0, 6).map((s) => s.name).join(" | "));
  console.log(`projects ${d.projects.length}:`);
  for (const x of d.projects.slice(0, 6)) console.log("  -", x.title, x.client ? `[client ${x.client}]` : "", x.result ? `[result ${x.result.slice(0, 80)}]` : "", x.summary.slice(0, 80));
  console.log(`testimonials ${d.testimonials.length}:`);
  for (const x of d.testimonials.slice(0, 4)) console.log("  -", x.quote.slice(0, 110), "--", x.author, x.role);
  console.log(`clients ${d.clients.length}:`, d.clients.slice(0, 12).map((c) => c.name).join(", "));
  console.log("contact", JSON.stringify(d.contact), "socials", d.socials.map((s) => s.network).join(","), "scriptOnly", d.scriptOnly);
}

const sites = process.argv.slice(2);
(async () => {
  for (const s of sites) await one(s).catch((e) => console.log(`\n=== ${s} FAILED:`, e));
})();
