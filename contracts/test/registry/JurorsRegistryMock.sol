pragma solidity ^0.5.8;

import "../../registry/JurorsRegistry.sol";


contract JurorsRegistryMock is JurorsRegistry {
    string private constant ERROR_INVALID_MOCK_LOCK_AMOUNT = 'JR_INVALID_MOCK_LOCK_AMOUNT';

    bool internal nextDraftMocked;
    address[] internal mockedSelectedJurors;

    constructor (Controller _controller, ERC20 _jurorToken, uint256 _minActiveBalance, uint256 _totalActiveBalanceLimit)
        public
        JurorsRegistry(_controller, _jurorToken, _minActiveBalance, _totalActiveBalanceLimit)
    {}

    function mockLock(address _juror, uint256 _leftUnlockedAmount) external {
        Juror storage juror = jurorsByAddress[_juror];
        uint256 active = _existsJuror(juror) ? tree.getItem(juror.id) : 0;
        require(_leftUnlockedAmount < active, ERROR_INVALID_MOCK_LOCK_AMOUNT);
        juror.lockedBalance = active - _leftUnlockedAmount;
    }

    function collect(address _juror, uint256 _amount) external {
        Juror storage juror = jurorsByAddress[_juror];
        uint64 nextTermId = _getLastEnsuredTermId() + 1;
        tree.update(juror.id, nextTermId, _amount, false);
    }

    function mockNextDraft(address[] calldata _selectedJurors, uint256[] calldata _weights) external {
        nextDraftMocked = true;

        delete mockedSelectedJurors;
        for (uint256 i = 0; i < _selectedJurors.length; i++) {
            for (uint256 j = 0; j < _weights[i]; j++) {
                mockedSelectedJurors.push(_selectedJurors[i]);
            }
        }
    }

    function _treeSearch(DraftParams memory _params) internal view returns (uint256[] memory, uint256[] memory) {
        if (nextDraftMocked) {
            return _runMockedSearch(_params);
        }
        return super._treeSearch(_params);
    }

    function _runMockedSearch(DraftParams memory _params) internal view returns (uint256[] memory ids, uint256[] memory activeBalances) {
        uint256 length = mockedSelectedJurors.length;
        ids = new uint256[](length);
        activeBalances = new uint256[](length);

        for (uint256 i = 0; i < mockedSelectedJurors.length; i++) {
            address juror = mockedSelectedJurors[i];
            uint256 id = jurorsByAddress[juror].id;
            uint256 activeBalance = tree.getItemAt(id, _params.termId);

            ids[i] = id;
            activeBalances[i] = activeBalance;
        }
    }
}
