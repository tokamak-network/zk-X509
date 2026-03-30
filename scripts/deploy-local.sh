#!/bin/sh
set -e

# Allow overriding via environment. Defaults are standard Anvil dev account.
DEFAULT_SENDER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
DEFAULT_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
RPC_URL="${RPC_URL:-http://anvil:8545}"
SENDER="${SENDER:-$DEFAULT_SENDER}"
PRIVATE_KEY="${PRIVATE_KEY:-$DEFAULT_PRIVATE_KEY}"

# Safety: refuse default dev key against non-local RPC
if [ "$PRIVATE_KEY" = "$DEFAULT_PRIVATE_KEY" ]; then
  case "$RPC_URL" in
    http://anvil:*|http://localhost:*|http://127.0.0.1:*)
      ;;
    *)
      echo "ERROR: Refusing to use default dev PRIVATE_KEY against non-local RPC_URL: $RPC_URL" >&2
      exit 1
      ;;
  esac
fi

echo "=== Deploying contracts ==="
# Capture output but ensure logs are printed even on failure
set +e
OUTPUT=$(forge script script/DeployLocal.s.sol:DeployLocalScript \
  --rpc-url "$RPC_URL" --broadcast \
  --sender "$SENDER" --private-key "$PRIVATE_KEY" 2>&1)
FORGE_EXIT=$?
set -e

echo "$OUTPUT"

if [ "$FORGE_EXIT" -ne 0 ]; then
  echo "ERROR: forge deployment failed with exit code $FORGE_EXIT"
  exit "$FORGE_EXIT"
fi

# Parse deployed addresses from forge output
FACTORY=$(echo "$OUTPUT" | awk '/RegistryFactory:/ {print $NF; exit}')
VERIFIER=$(echo "$OUTPUT" | awk '/SP1VerifierGroth16/ {print $NF; exit}')

if [ -z "$FACTORY" ] || [ -z "$VERIFIER" ]; then
  echo "ERROR: Failed to parse contract addresses. Check forge output above."
  exit 1
fi

echo ""
echo "=== Seeding local data ==="
echo "FACTORY=$FACTORY"

FACTORY=$FACTORY forge script script/SeedLocal.s.sol:SeedLocalScript \
  --rpc-url "$RPC_URL" --broadcast \
  --sender "$SENDER" --private-key "$PRIVATE_KEY"

# Write addresses to shared volume (for frontend/backend)
cat > /shared/addresses.json <<EOF
{
  "factory": "$FACTORY",
  "verifier": "$VERIFIER"
}
EOF

# Also write to host-mounted path (for developer reference)
cp /shared/addresses.json /host-root/.docker-addresses.json 2>/dev/null || true

echo ""
echo "=== Deploy complete ==="
echo "FACTORY=$FACTORY"
echo "VERIFIER=$VERIFIER"
