#!/usr/bin/env bash

# Exit script as soon as a command fails.
set -o errexit

# Court known addresses
court_ropsten=0x3b26bc496aebaed5b3E0E81cDE6B582CDe71396e
court_staging=0x52180af656a1923024d1accf1d827ab85ce48878
court_rinkeby=0xf7970965489f4d4eafcf5fad55ca5ea57fb4bfcb
court_mainnet=0xee4650cBe7a2B23701D416f58b41D8B76b617797

# Known block numbers
start_block_ropsten=6819000
start_block_staging=6199000
start_block_rinkeby=7238369
start_block_mainnet=9017000

# Validate network
networks=(rpc ropsten staging rinkeby mainnet)
if [[ -z $NETWORK || ! " ${networks[@]} " =~ " ${NETWORK} " ]]; then
  echo 'Please make sure the network provided is either rpc, ropsten, staging, rinkeby, or mainnet.'
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

# Load start block
if [[ -z $START_BLOCK ]]; then
  START_BLOCK_VAR=start_block_$NETWORK
  START_BLOCK=${!START_BLOCK_VAR}
fi
if [[ -z $START_BLOCK ]]; then
  START_BLOCK=0
fi

# Try loading Court address if missing
if [[ -z $COURT ]]; then
  COURT_VAR=court_$NETWORK
  COURT=${!COURT_VAR}
fi

# Validate court address
if [[ -z $COURT ]]; then
  echo 'Please make sure a Court address is provided'
  exit 1
fi

# Remove previous subgraph if there is any
if [ -f subgraph.yaml ]; then
  echo 'Removing previous subgraph manifest...'
  rm subgraph.yaml
fi

# Build subgraph manifest for requested variables
echo "Preparing new subgraph for Court address ${COURT} to network ${NETWORK}"
cp subgraph.template.yaml subgraph.yaml
sed -i -e "s/{{network}}/${ENV}/g" subgraph.yaml
sed -i -e "s/{{court}}/${COURT}/g" subgraph.yaml
sed -i -e "s/{{startBlock}}/${START_BLOCK}/g" subgraph.yaml
rm -f subgraph.yaml-e
