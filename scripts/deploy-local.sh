#!/bin/sh
set -e

RPC_URL="http://anvil:8545"
SENDER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

echo "=== Deploying contracts ==="
OUTPUT=$(forge script script/DeployLocal.s.sol:DeployLocalScript \
  --rpc-url "$RPC_URL" --broadcast \
  --sender "$SENDER" --private-key "$PRIVATE_KEY" 2>&1)

echo "$OUTPUT"

# Parse deployed addresses from forge output
FACTORY=$(echo "$OUTPUT" | grep 'RegistryFactory:' | awk '{print $NF}')
VERIFIER=$(echo "$OUTPUT" | grep 'SP1VerifierGroth16' | awk '{print $NF}')

if [ -z "$FACTORY" ]; then
  echo "ERROR: Failed to parse RegistryFactory address"
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
