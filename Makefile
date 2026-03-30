.PHONY: up down clean status logs addresses

## Docker local environment
up:                ## Start all services (build + deploy + run)
	docker compose up --build -d
	@echo ""
	@echo "Waiting for deployer to finish..."
	@docker compose wait deployer 2>/dev/null
	@docker compose logs deployer
	@echo ""
	@echo "Services running:"
	@echo "   Frontend   → http://localhost:3000"
	@echo "   Backend    → http://localhost:4000"
	@echo "   Anvil RPC  → http://localhost:8545"
	@echo "   Chain ID   → 31337"
	@echo ""
	@cat .docker-addresses.json 2>/dev/null && echo "" || echo "Addresses not yet available. Run: make addresses"

down:              ## Stop all services (chain state resets on next up)
	docker compose down

clean:             ## Stop all services, remove volumes, and clear cached addresses
	docker compose down -v
	rm -f .docker-addresses.json

status:            ## Show service status
	docker compose ps

logs:              ## Tail logs (usage: make logs or make logs s=frontend)
	docker compose logs -f $(s)

addresses:         ## Show deployed contract addresses
	@cat .docker-addresses.json 2>/dev/null || echo "No addresses found. Run: make up"

help:              ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  make %-12s %s\n", $$1, $$2}'
