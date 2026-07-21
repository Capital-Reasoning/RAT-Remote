# Security policy

RAT Remote is a public, static client. It must never contain credentials, private endpoint values, project data, audio, transcripts, or model configuration.

The private gateway must enforce password authentication, short-lived sessions, HTTPS, exact-origin CORS, request-size limits, and rate limiting. A hidden interface URL is not access control.

Do not include a password, gateway URL, session token, private IP address, project export, or user document in a public issue. Contact the repository owners privately if a report contains sensitive operational details.
