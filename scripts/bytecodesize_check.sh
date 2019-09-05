#!/bin/bash

CONTRACT='Court'

source $(dirname $0)/bytecodesize_func.sh

rm -Rf $(dirname $0)/../build/contracts
npx truffle compile > /dev/null
SIZE=$(compute_bytecode_size $CONTRACT)

if [[ $SIZE > 24576 ]]; then
    echo "Size too big! $SIZE"
    exit 1
fi

echo "Size is good: $SIZE"

