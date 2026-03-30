#!/bin/sh
set -e

# Read deployed contract addresses from shared volume (written by deployer)
if [ -f /shared/addresses.json ]; then
  FACTORY=$(node -p 'require("/shared/addresses.json").factory')
  VERIFIER=$(node -p 'require("/shared/addresses.json").verifier')

  export NEXT_PUBLIC_FACTORY_ADDRESS="$FACTORY"
  export NEXT_PUBLIC_SP1_VERIFIER_ADDRESS="$VERIFIER"

  echo "Loaded contract addresses:"
  echo "  NEXT_PUBLIC_FACTORY_ADDRESS=$FACTORY"
  echo "  NEXT_PUBLIC_SP1_VERIFIER_ADDRESS=$VERIFIER"
else
  echo "WARNING: /shared/addresses.json not found, starting without contract addresses"
fi

exec npm run dev
