#!/usr/bin/env bash

# Exit script as soon as a command fails.
set -o errexit

# Ensure subgraph was not created
if [ -f subgraph.yaml ]; then
  echo 'Found previous subgraph manifest. Please remove it or back it up and re-run the deployment script again.'
  exit 1
fi

# Validate network
networks=(rpc ropsten rinkeby mainnet)
if [[ -z $NETWORK || ! " ${networks[@]} " =~ " ${NETWORK} " ]]; then
  echo 'Please make sure the network provided is either rpc, ropsten, rinkeby or mainnet.'
  exit 1
fi

# Validate contract addresses
if [[ -z $COURT ]]; then
  echo 'Please make sure a Court address is provided'
  exit 1
fi

# Use mainnet network in case of local deployment
if [[ "$NETWORK" = "rpc" ]]; then
  ENV='mainnet'
else
  ENV=${NETWORK}
fi

# Build subgraph manifest for requested variables
cp subgraph.template.yaml subgraph.yaml
sed -i -e "s/{{network}}/${ENV}/g" subgraph.yaml
sed -i -e "s/{{court}}/${COURT}/g" subgraph.yaml
rm subgraph.yaml-e

# Run codegen
npm run codegen

# Create subgraph if missing
{
  if [[ "$NETWORK" = "rpc" ]]; then
    npm run create:rpc
  else
    npm run create:remote
  fi
} || {
  echo 'Subgraph was already created'
}

# Deploy subgraph
if [[ "$NETWORK" = "rpc" ]]; then
  npm run deploy:rpc
else
  npm run deploy:remote
fi
