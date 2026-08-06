// Production ships via `git archive HEAD` (see DEPLOY.md), and `git archive`
// omits the .git directory from the tarball it produces — so nothing inside
// the Docker build context can run `git rev-parse` to learn what commit it
// was built from. Git's own export-subst attribute is the workaround: any
// file listed in .gitattributes with `export-subst` gets its `$Format:...$`
// placeholders substituted at archive time, before the tarball is written.
// That makes this file itself the version record, not a value computed at
// build time.
//
// In the working tree (dev, or a checkout built without going through
// `git archive`, e.g. the test stack), the placeholder is never substituted
// and stays the literal string below — that's expected, not a bug.
const RAW = "$Format:%h$";

export const BUILD_ID = RAW.startsWith("$Format") ? "dev" : RAW;
