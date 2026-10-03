/**
 * What a screen shows while it is waiting.
 *
 * A line of prose in the middle of an empty page reads as the content having
 * arrived and being disappointing. A turning mark reads as "not yet", which is
 * the true thing. The words stay for screen readers, who get nothing from a
 * spinning square.
 */
export function Loader({ label = "Loading" }: { label?: string }) {
  return (
    <p className="loader" role="status">
      <span className="loader-mark" aria-hidden />
      <span className="sr-only">{label}</span>
    </p>
  );
}
