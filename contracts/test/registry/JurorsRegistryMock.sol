pragma solidity ^0.5.8;

import "../lib/TimeHelpersMock.sol";
import "../../registry/JurorsRegistry.sol";


contract JurorsRegistryMock is JurorsRegistry, TimeHelpersMock {
    bool internal treeSearchHijacked;
    bool internal nextDraftMocked;
    address[] public mockedSelectedJurors;
    uint256[] public mockedWeights;

    constructor (Controller _controller, ERC20 _jurorToken, uint256 _minActiveBalance, uint256 _totalActiveBalanceLimit)
        public
        JurorsRegistry(_controller, _jurorToken, _minActiveBalance, _totalActiveBalanceLimit)
    {}

    function mockNextDraft(address[] calldata _selectedJurors, uint256[] calldata _weights) external {
        nextDraftMocked = true;

        delete mockedSelectedJurors;
        for (uint256 i = 0; i < _selectedJurors.length; i++) {
            mockedSelectedJurors.push(_selectedJurors[i]);
        }

        delete mockedWeights;
        for (uint256 j = 0; j < _weights.length; j++) {
            mockedWeights.push(_weights[j]);
        }
    }

    function _treeSearch(DraftParams memory _params) internal view returns (uint256[] memory, uint256[] memory) {
        if (nextDraftMocked) {
            return _runMockedSearch(_params);
        }
        return super._treeSearch(_params);
    }

    function _runMockedSearch(DraftParams memory _params) internal view returns (uint256[] memory ids, uint256[] memory activeBalances) {
        uint256 totalLength = 0;
        for (uint256 k = 0; k < mockedWeights.length; k++) {
            totalLength += mockedWeights[k];
        }

        ids = new uint256[](totalLength);
        activeBalances = new uint256[](totalLength);

        uint256 index = 0;
        for (uint256 i = 0; i < mockedSelectedJurors.length; i++) {
            address juror = mockedSelectedJurors[i];
            uint256 id = jurorsByAddress[juror].id;
            uint256 activeBalance = tree.getItemAt(id, _params.termId);

            for (uint256 j = 0; j < mockedWeights[i]; j++) {
                ids[index] = id;
                activeBalances[index] = activeBalance;
                index++;
            }
        }
    }

    function lockAll(address _juror) external {
        Juror storage juror = jurorsByAddress[_juror];

        uint256 active = _existsJuror(juror) ? tree.getItem(juror.id) : 0;
        juror.lockedBalance = active;
    }
}
