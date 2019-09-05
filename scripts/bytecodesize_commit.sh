#!/bin/bash

CONTRACT='Court'

source $(dirname $0)/bytecodesize_func.sh

HEAD=$(git rev-parse --abbrev-ref HEAD)
COMMIT=$1
if [[ -z $COMMIT ]]; then
    echo "You must provide a commit"
    exit 1
fi

git checkout $COMMIT > /dev/null 2>&1
if [[ $? > 0 ]]; then
    echo "Checkout failed!"
    exit 1
fi
rm -Rf $(dirname $0)/../build/contracts
npx truffle compile > /dev/null
SIZE=$(compute_bytecode_size $CONTRACT)
echo $SIZE $(git log -1 --oneline)

git checkout $HEAD > /dev/null 2>&1
