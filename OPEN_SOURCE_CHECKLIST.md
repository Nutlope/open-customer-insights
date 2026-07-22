# Open-source release checklist

Do not make this repository public until every remaining blocking item below is complete. The private operational repository stays private.

## Blocking review

- [ ] Choose and approve the license and copyright holder.
- [ ] Review the complete release diff for product, security, and documentation quality.
- [ ] Confirm that all examples, screenshots, tests, and fixtures use synthetic data.
- [x] Confirm that every optional integration safely skips scheduled work when unconfigured.
- [x] Verify a fresh install, tests, typecheck, and production build without private environment files.

## Clean publication history

This repository was created from an approved source snapshot without copying the private operational history.

- [x] Start from a new clean root commit containing only the release snapshot.
- [x] Scan the clean publication history with Gitleaks.
- [x] Search the clean snapshot for private deployment origins, personal emails, channel IDs, customer data, and credentials.
- [x] Verify that local databases, exports, and research artifacts are absent.

## GitHub and launch

- [ ] Enable secret scanning, push protection, and Dependabot alerts where available.
- [ ] Configure repository topics, description, and security-policy link.
- [ ] Make the approved clean repository public only after the preceding checks pass.
- [ ] Review and approve any announcement separately.
