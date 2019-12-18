#!/usr/bin/env bash

# Exit script as soon as a command fails.
set -o errexit

# Ensure subgraph was not created
if [ -f subgraph.yaml ]; then
  echo 'Found previous subgraph manifest. Please remove it or back it up and re-run the deployment script again.'
  exit 1
fi

# Validate network
networks=(rpc staging ropsten rinkeby mainnet)
if [[ -z $NETWORK || ! " ${networks[@]} " =~ " ${NETWORK} " ]]; then
  echo 'Please make sure the network provided is either rpc, staging, ropsten, rinkeby, or mainnet.'
  exit 1
fi

# Use mainnet network in case of local deployment
if [[ "$NETWORK" = "rpc" ]]; then
  ENV='mainnet'
elif [[ "$NETWORK" = "staging" ]]; then
  ENV='rinkeby'
else
  ENV=${NETWORK}
fi

# Validate court address
if [[ -z $COURT ]]; then
  if [[ -f subgraph.${NETWORK}.yaml ]]; then
    # Copy network subgraph manifest
    echo "Redeploying subgraph using subgraph.${NETWORK}.yml manifest"
    mv subgraph.${NETWORK}.yaml subgraph.yaml
  else
    echo 'Please make sure a Court address is provided'
    exit 1
  fi
else
  # Build subgraph manifest for requested variables
  echo "Deploying new subgraph for court address ${COURT} to network ${NETWORK}"
  cp subgraph.template.yaml subgraph.yaml
  sed -i -e "s/{{network}}/${ENV}/g" subgraph.yaml
  sed -i -e "s/{{court}}/${COURT}/g" subgraph.yaml
  rm subgraph.yaml-e
fi

# Run codegen
npm run codegen

# Use custom subgraph name based on target network
if [[ "$NETWORK" != "mainnet" ]]; then
  SUBGRAPH_EXT="-${NETWORK}"
else
  SUBGRAPH_EXT=""
fi

# Select IPFS and The Graph nodes
if [[ "$NETWORK" = "rpc" ]]; then
  IPFS_NODE="http://localhost:5001"
  GRAPH_NODE="http://127.0.0.1:8020"
else
  IPFS_NODE="https://api.thegraph.com/ipfs/"
  GRAPH_NODE="https://api.thegraph.com/deploy/"
fi

# Create subgraph if missing
{
  graph create aragon/aragon-court${SUBGRAPH_EXT} --node ${GRAPH_NODE}
} || {
  echo 'Subgraph was already created'
}

# Deploy subgraph
graph deploy aragon/aragon-court${SUBGRAPH_EXT} --ipfs ${IPFS_NODE} --node ${GRAPH_NODE}

# Save manifest for custom network
mv subgraph.yaml subgraph.${NETWORK}.yaml
