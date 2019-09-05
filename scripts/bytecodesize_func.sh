#!/bin/bash

compute_bytecode_size() {
    cat build/contracts/$1.json | grep deployedBytecode | cut -d':' -f2 | cut -d'"' -f2 | wc -m | xargs -I {} echo "{} / 2 - 1" | bc
}
