pragma solidity ^0.5.8;


contract ClockConstants {
    // Initial term to start the Court, disputes are not allowed during this term. It can be used to activate jurors.
    uint64 internal constant ZERO_TERM_ID = 0;

    // First term where the Court can start having disputes activity.
    uint64 internal constant START_TERM_ID = 1;
}
