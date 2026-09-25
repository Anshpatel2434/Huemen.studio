/**
 * PDF export of the brand brief (brief §4.5 / TASKS P3-7). Same content as the
 * Markdown export, laid out as a document the client can send on: cover, brief,
 * voice, visual identity, pillars, offers, calendar, then the pieces.
 *
 * Rendered with @react-pdf/renderer — pure JS, no headless browser, so it runs
 * anywhere the app runs. Monochrome like the app, and carrying the client's
 * brand name only: no Okra marks (§4.7).
 *
 * Server-only.
 */
import "server-only";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { FoundationForm } from "@/lib/data/foundation-types";
import type { ContentItemView } from "@/lib/data/content";
import type { CalendarEntryView, OfferView, PillarView } from "@/lib/data/planning";
import { formatByKey } from "@/lib/content/formats";

export interface ExportInput {
  brandName: string;
  foundation: FoundationForm;
  pillars: PillarView[];
  content: ContentItemView[];
  calendar: CalendarEntryView[];
  offers: OfferView[];
  generatedAt: Date;
  /** Shown on the cover, e.g. "Approved pieces only". */
  scopeLabel: string;
}

const INK = "#0a0a0a";
const MUTED = "#525252";
const FAINT = "#8a8a8a";
const HAIRLINE = "#e2e2e2";

const s = StyleSheet.create({
  page: { paddingTop: 54, paddingBottom: 56, paddingHorizontal: 54, fontFamily: "Helvetica", fontSize: 10, color: INK, lineHeight: 1.5 },
  coverPage: { padding: 54, fontFamily: "Helvetica", color: INK, justifyContent: "space-between" },
  eyebrow: { fontFamily: "Helvetica-Bold", fontSize: 8, letterSpacing: 1.6, color: FAINT },
  coverTitle: { fontSize: 32, lineHeight: 1.15, marginTop: 14, maxWidth: 420 },
  coverSub: { fontSize: 11, color: MUTED, marginTop: 14, maxWidth: 380, lineHeight: 1.55 },
  coverMeta: { fontSize: 9, color: FAINT, marginTop: 6 },
  rule: { borderBottomWidth: 1, borderBottomColor: INK, marginVertical: 18 },
  h2: { fontSize: 15, marginBottom: 10, marginTop: 4 },
  h3: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginBottom: 4 },
  sectionHead: { fontFamily: "Helvetica-Bold", fontSize: 8, letterSpacing: 1.4, color: FAINT, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: HAIRLINE, paddingBottom: 6 },
  p: { marginBottom: 9 },
  muted: { color: MUTED },
  label: { fontFamily: "Helvetica-Bold" },
  block: { marginBottom: 16 },
  row: { flexDirection: "row", marginBottom: 4 },
  rowLabel: { width: 96, color: MUTED },
  rowValue: { flex: 1 },
  bullet: { flexDirection: "row", marginBottom: 3 },
  dot: { width: 12, color: FAINT },
  card: { borderWidth: 1, borderColor: HAIRLINE, borderRadius: 4, padding: 12, marginBottom: 10 },
  quote: { borderLeftWidth: 2, borderLeftColor: INK, paddingLeft: 10, marginVertical: 8, color: MUTED },
  tableHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 4, marginBottom: 4, fontFamily: "Helvetica-Bold", fontSize: 9 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: HAIRLINE, paddingVertical: 4, fontSize: 9 },
  hook: { fontFamily: "Helvetica-Bold", fontSize: 11, marginBottom: 6, lineHeight: 1.35 },
  cta: { fontFamily: "Helvetica-Bold", marginTop: 8, fontSize: 9.5 },
  swatchRow: { flexDirection: "row", marginTop: 4 },
  swatch: { width: 42, height: 42, borderRadius: 3, borderWidth: 1, borderColor: HAIRLINE, marginRight: 6 },
  swatchLabel: { fontSize: 7, color: FAINT, marginTop: 3 },
  footer: { position: "absolute", bottom: 26, left: 54, right: 54, flexDirection: "row", fontSize: 8, color: FAINT, borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 6 },
});

const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
const date = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

function Bullets({ items }: { items: string[] }) {
  return (
    <>
      {items.map((t, i) => (
        <View key={i} style={s.bullet}>
          <Text style={s.dot}>—</Text>
          <Text style={{ flex: 1 }}>{t}</Text>
        </View>
      ))}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.block}>
      <Text style={s.sectionHead}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Footer({ brandName }: { brandName: string }) {
  return (
    <View style={s.footer} fixed>
      <Text style={{ flex: 1 }}>{brandName} · brand brief</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function BriefDocument(input: ExportInput) {
  const { brandName: name, foundation: f } = input;
  const palette = list(f.palette);
  const chapters = f.chapters.filter((c) => c.body.trim());
  const samples = f.samplePosts.split("\n").map((x) => x.trim()).filter(Boolean);

  return (
    <Document title={`${name} — brand brief`} author={name} creator={name} producer={name}>
      {/* Cover */}
      <Page size="A4" style={s.coverPage}>
        <View>
          <Text style={s.eyebrow}>BRAND BRIEF</Text>
          <Text style={s.coverTitle}>{name}</Text>
          {!!f.positioning && <Text style={s.coverSub}>{f.positioning}</Text>}
        </View>
        <View>
          <View style={s.rule} />
          <View style={s.row}><Text style={s.rowLabel}>Exported</Text><Text style={s.rowValue}>{date(input.generatedAt)}</Text></View>
          <View style={s.row}><Text style={s.rowLabel}>Included</Text><Text style={s.rowValue}>{input.scopeLabel}</Text></View>
          <View style={s.row}><Text style={s.rowLabel}>Contents</Text><Text style={s.rowValue}>Brief · Voice · Visual identity · Pillars{input.offers.length ? " · Offers" : ""}{input.calendar.length ? " · Calendar" : ""} · {input.content.length} piece{input.content.length === 1 ? "" : "s"}</Text></View>
          <Text style={s.coverMeta}>Generated by Huemen.studio from this brand&apos;s stored brief.</Text>
        </View>
      </Page>

      {/* The brief */}
      <Page size="A4" style={s.page}>
        <Footer brandName={name} />
        <Text style={s.h2}>The brand</Text>

        <Section title="What they do">
          {!!f.niche && <View style={s.row}><Text style={s.rowLabel}>Niche</Text><Text style={s.rowValue}>{f.niche}</Text></View>}
          {!!f.audience && <View style={s.row}><Text style={s.rowLabel}>Audience</Text><Text style={s.rowValue}>{f.audience}</Text></View>}
          {!!f.offers && <View style={s.row}><Text style={s.rowLabel}>Offers</Text><Text style={s.rowValue}>{f.offers}</Text></View>}
        </Section>

        {chapters.length > 0 && (
          <Section title="Story arc">
            {chapters.map((c, i) => (
              <View key={i} style={s.p}>
                <Text style={s.h3}>{c.title || ["Where it started", "What changed", "What I do now"][i]}</Text>
                <Text>{c.body}</Text>
              </View>
            ))}
          </Section>
        )}

        <Section title="Voice">
          {!!f.tone && <View style={s.row}><Text style={s.rowLabel}>Tone</Text><Text style={s.rowValue}>{f.tone}</Text></View>}
          {!!f.readingLevel && <View style={s.row}><Text style={s.rowLabel}>Reading level</Text><Text style={s.rowValue}>{f.readingLevel}</Text></View>}
          {list(f.doWords).length > 0 && <View style={s.row}><Text style={s.rowLabel}>Use</Text><Text style={s.rowValue}>{list(f.doWords).join(" · ")}</Text></View>}
          {list(f.dontWords).length > 0 && <View style={s.row}><Text style={s.rowLabel}>Never use</Text><Text style={s.rowValue}>{list(f.dontWords).join(" · ")}</Text></View>}
        </Section>

        {samples.length > 0 && (
          <Section title="How it should sound">
            <Bullets items={samples} />
          </Section>
        )}

        <Section title="Visual identity">
          {palette.length > 0 && (
            <View style={s.block}>
              <Text style={s.muted}>Palette</Text>
              <View style={s.swatchRow}>
                {palette.map((c) => (
                  <View key={c}>
                    <View style={[s.swatch, { backgroundColor: c }]} />
                    <Text style={s.swatchLabel}>{c.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
          {!!f.fonts && <View style={s.row}><Text style={s.rowLabel}>Fonts</Text><Text style={s.rowValue}>{f.fonts}</Text></View>}
          {!!f.imageStyleNotes && <View style={s.row}><Text style={s.rowLabel}>Imagery</Text><Text style={s.rowValue}>{f.imageStyleNotes}</Text></View>}
        </Section>

        {input.pillars.length > 0 && (
          <Section title="Content pillars">
            {input.pillars.map((p) => (
              <View key={p.id} style={s.p}>
                <Text style={s.h3}>{p.name}</Text>
                {!!p.description && <Text style={s.muted}>{p.description}</Text>}
                <Text style={{ color: FAINT, fontSize: 9 }}>{p.contentCount} piece{p.contentCount === 1 ? "" : "s"}</Text>
              </View>
            ))}
          </Section>
        )}
      </Page>

      {/* Offers + calendar */}
      {(input.offers.length > 0 || input.calendar.length > 0) && (
        <Page size="A4" style={s.page}>
          <Footer brandName={name} />
          <Text style={s.h2}>Offers &amp; calendar</Text>

          {input.offers.length > 0 && (
            <Section title="Offers">
              {input.offers.map((o) => (
                <View key={o.id} style={s.card} wrap={false}>
                  <Text style={s.h3}>{o.name}</Text>
                  {!!o.format && <Text style={{ color: FAINT, fontSize: 9 }}>{o.format}</Text>}
                  {!!o.promise && <Text style={s.quote}>{o.promise}</Text>}
                  {o.deliverables.length > 0 && <Bullets items={o.deliverables} />}
                  {!!o.pricingLogic && <Text style={[s.muted, { marginTop: 6 }]}><Text style={s.label}>Pricing logic: </Text>{o.pricingLogic}</Text>}
                </View>
              ))}
            </Section>
          )}

          {input.calendar.length > 0 && (
            <Section title="Calendar">
              <View style={s.tableHead}>
                <Text style={{ width: 80 }}>Date</Text>
                <Text style={{ width: 70 }}>Channel</Text>
                <Text style={{ width: 120 }}>Pillar</Text>
                <Text style={{ flex: 1 }}>Topic</Text>
              </View>
              {input.calendar.map((e) => (
                <View key={e.id} style={s.tableRow}>
                  <Text style={{ width: 80 }}>{e.date}</Text>
                  <Text style={{ width: 70 }}>{e.channel ?? "—"}</Text>
                  <Text style={{ width: 120 }}>{e.pillarName ?? "—"}</Text>
                  <Text style={{ flex: 1 }}>{e.topic ?? "—"}</Text>
                </View>
              ))}
            </Section>
          )}
        </Page>
      )}

      {/* The content */}
      {input.content.length > 0 && (
        <Page size="A4" style={s.page}>
          <Footer brandName={name} />
          <Text style={s.h2}>Content</Text>
          <Text style={[s.muted, s.p]}>{input.scopeLabel}. Each piece is written from the brief above.</Text>
          {input.content.map((c) => (
            <View key={c.id} style={s.card} wrap={false}>
              <Text style={{ color: FAINT, fontSize: 8, letterSpacing: 1.2, marginBottom: 6 }}>
                {formatByKey(c.format).label.toUpperCase()}
                {c.pillarName ? ` · ${c.pillarName.toUpperCase()}` : ""} · {c.status.toUpperCase()}
              </Text>
              {!!c.hook && <Text style={s.hook}>{c.hook}</Text>}
              {!!c.body && <Text>{c.body}</Text>}
              {!!c.cta && (
                <Text style={s.cta}>
                  <Text style={{ color: FAINT }}>CALL TO ACTION  </Text>
                  {c.cta}
                </Text>
              )}
            </View>
          ))}
        </Page>
      )}
    </Document>
  );
}

export function buildPdf(input: ExportInput): Promise<Buffer> {
  return renderToBuffer(<BriefDocument {...input} />);
}
