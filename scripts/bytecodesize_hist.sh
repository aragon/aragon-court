#!/bin/bash

CONTRACT='Court'
STEPS=$1

if [[ -z $STEPS ]]; then
    STEPS=20
fi

source $(dirname $0)/bytecodesize_func.sh

HEAD=$(git rev-parse --abbrev-ref HEAD)
for i in $(seq 1 $STEPS); do
    git checkout HEAD~1 > /dev/null 2>&1
    rm -Rf $(dirname $0)/../build/contracts
    npx truffle compile > /dev/null
    SIZE=$(compute_bytecode_size $CONTRACT)
    echo $SIZE $(git log -1 --oneline)
done;

git checkout $HEAD > /dev/null 2>&1
