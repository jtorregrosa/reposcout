## ADDED Requirements

### Requirement: Jira credential handling
RepoScout SHALL read the Jira email and API token only from the environment variables `jira.email_env` and `jira.token_env` name, register both as secrets to redact, and send them only in the `Authorization` header of requests to the configured site. They MUST NOT reach the browser, a log, the action log, a report or Claude's environment.

#### Scenario: Action log after a report
- **WHEN** an auditor reports a finding and the action is logged
- **THEN** the line in `dashboard-actions.jsonl` holds the request and the issue key, and neither the token nor the email

#### Scenario: Token in a Jira error
- **WHEN** Jira's error message quotes the request's credentials
- **THEN** the message shown in the dashboard has them redacted

### Requirement: Jira requests only to the configured site
RepoScout MUST send Jira requests only over HTTPS to the configured `site`, build their paths itself, and refuse to follow a redirect to another origin. Values from the dashboard, such as a project key, a parent key or a search text, MUST reach Jira only as encoded path segments, query values or JSON body fields.

#### Scenario: Redirect to another host
- **WHEN** Jira answers a request with a redirect to another host
- **THEN** the redirect is not followed and the request fails

#### Scenario: Crafted project key
- **WHEN** a lookup asks for the project `../../rest/api/3/user`
- **THEN** it is refused with status 400 and nothing is sent to Jira
