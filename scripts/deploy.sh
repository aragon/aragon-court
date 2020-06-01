#!/usr/bin/env bash

# Exit script as soon as a command fails.
set -o errexit

# Run graph build
npm run build:graph

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
