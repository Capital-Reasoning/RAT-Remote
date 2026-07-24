# Security policy

RAT Council Remote is a public, static client. It must never contain credentials,
password hashes, bearer sessions, project data, audio, transcripts, prompts, or
model configuration.

The public gateway hostname may be present because it is routing information,
not a credential. The private gateway must enforce password authentication,
short-lived sessions, HTTPS, exact-origin CORS, a narrow endpoint allowlist,
request-size limits, and rate limiting. A hidden interface URL is not access
control.

Do not include a password, session token, private IP address, project export, or
user document in a public issue. Contact the repository owners privately if a
report contains sensitive operational details.
