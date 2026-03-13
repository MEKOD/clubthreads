# Security Policy

If you believe you found a security issue in Club Threads, please do not file a public GitHub issue.

Send reports to `mert38338@gmail.com`.

## How to report

Send a private report to the repository maintainer with:

- a short description of the issue
- the affected area or file paths
- reproduction steps
- impact assessment
- any suggested fix or mitigation

If you already have a patch, mention that in the report, but avoid publishing an exploit before a fix is available.

## What to include

Useful reports usually include:

- whether the issue requires authentication
- whether it affects local development only or production deployments
- whether user data, tokens, uploads, or admin surfaces are involved
- logs, screenshots, or request examples when relevant

## Preferred disclosure flow

1. Report the issue privately.
2. Wait for acknowledgement and triage.
3. Coordinate on a fix and release window.
4. Publish details only after the fix is available or a mitigation is documented.

## Scope

The highest-priority classes of issues are:

- authentication or authorization bypass
- privilege escalation
- secret exposure
- unsafe file upload or media handling
- SSRF, request smuggling, or unsafe link preview fetching
- stored or reflected XSS
- SQL injection
- broken access control in communities, direct messages, or admin routes

## Response expectations

This is an independent project, so response times may vary. Good-faith reports will be reviewed and handled as quickly as possible.

## Safe harbor

Please act in good faith:

- do not access, modify, or destroy other users' data
- do not run denial-of-service attacks
- do not use social engineering, phishing, or physical access
- keep testing limited to accounts and environments you control
