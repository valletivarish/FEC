.PHONY: localstack-up localstack-down localstack-logs init-aws

localstack-up:
	docker compose up -d
	@echo "waiting for the local AWS emulator to become healthy..."
	@i=0; until curl -sf http://localhost:4566/_localstack/health > /dev/null || [ $$i -ge 60 ]; do sleep 2; i=$$((i+1)); done
	@curl -sf http://localhost:4566/_localstack/health > /dev/null && echo "local AWS emulator is up on :4566" || (echo "FAILED to become healthy after 120s" && docker compose logs --tail=50 && exit 1)

localstack-down:
	docker compose down

localstack-logs:
	docker compose logs -f localstack

init-aws:
	@for script in infra/localstack-init/*.sh; do \
		[ -f "$$script" ] && bash "$$script"; \
	done
