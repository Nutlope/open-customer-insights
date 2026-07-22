# Open-source release checklist

Do not make the existing private repository public until every blocking item below is complete.

## Blocking review

- [ ] Choose and approve the license and copyright holder.
- [ ] Review the complete release diff for product, security, and documentation quality.
- [ ] Confirm that all examples, screenshots, tests, and fixtures use synthetic data.
- [ ] Confirm that every optional integration safely skips scheduled work when unconfigured.
- [ ] Verify a fresh local setup using only `.env.example` and the documented steps.

## Clean publication history

The private Git history contains internal documentation and a private deployment origin that were removed from the current source. Do not expose that history.

- [ ] Publish from a new clean root commit or a separate public repository containing only the approved snapshot.
- [ ] Scan the clean publication history with Gitleaks.
- [ ] Search the clean snapshot for private deployment origins, personal emails, channel IDs, customer data, and credentials.
- [ ] Verify that ignored local databases, exports, and the local `research/` directory are absent.

## GitHub and launch

- [ ] Enable secret scanning, push protection, and Dependabot alerts where available.
- [ ] Configure repository topics, description, and security-policy link.
- [ ] Make the approved clean repository public only after the preceding checks pass.
- [ ] Review and approve any announcement separately.
