/**
 * SettingsSection — ChatGPT/Linear style: heading + dividers, no card.
 *
 * Each section is a `<section>` with an h2 + optional description, then a
 * `<div>` of children separated by row dividers. No outer border, no
 * rounded card chrome — that's the whole point of this redesign. Pair
 * with `InfoRow` children using `border={false}` on every row; the
 * `divide-y` on the wrapper supplies the row separators.
 *
 *   <SettingsSection title="Account">
 *     <InfoRow label="Name" value={name} border={false} />
 *     <InfoRow label="Email" value={email} border={false} />
 *   </SettingsSection>
 *
 * The top border on the rows container ties the section to its heading
 * the way ChatGPT's settings do — section title sits above a thin line,
 * rows hang below. Connections + Profile both consume this primitive.
 */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-medium">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="border-t divide-y [&>*]:py-3">{children}</div>
    </section>
  );
}

/**
 * SettingsPageHeader — page-level h1 + tagline.
 */
export function SettingsPageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description && (
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      )}
    </div>
  );
}
