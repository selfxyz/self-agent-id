// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

/**
 * @title ImplRoot
 * @author Self Protocol
 * @notice Abstract base for UUPS-upgradeable implementations with role-based access control
 * @dev Abstract contract providing upgradeable functionality via UUPSUpgradeable,
 * along with role-based access control using AccessControlUpgradeable.
 * Serves as a base for upgradeable implementations.
 *
 * Governance Roles:
 * - SECURITY_ROLE: Security-sensitive operations and role management (3/5 multisig consensus)
 * - OPERATIONS_ROLE: Routine operational tasks (2/5 multisig consensus)
 */
abstract contract ImplRoot is UUPSUpgradeable, AccessControlUpgradeable {
    /// @notice Security-sensitive operations requiring 3/5 multisig consensus
    bytes32 public constant SECURITY_ROLE = keccak256("SECURITY_ROLE");

    /// @notice Routine operations requiring 2/5 multisig consensus
    bytes32 public constant OPERATIONS_ROLE = keccak256("OPERATIONS_ROLE");

    // Reserved storage space to allow for layout changes in the future.
    uint256[50] private __gap;

    /**
     * @dev Initializes the contract by granting roles to the specified owner and
     * configuring the role admin hierarchy.
     *
     * Roles are granted ONLY to `initialOwner` — NOT to msg.sender. This prevents
     * the deployer from retaining admin access when deployer != initialOwner
     * (e.g., a deploy script EOA vs. a production multisig).
     *
     * This function should be called in the initializer of the derived contract.
     *
     * @param initialOwner The address that receives both SECURITY_ROLE and OPERATIONS_ROLE.
     */
    function __ImplRoot_init(address initialOwner) internal virtual onlyInitializing {
        __AccessControl_init();

        // Set role admins - SECURITY_ROLE manages all roles
        _setRoleAdmin(SECURITY_ROLE, SECURITY_ROLE);
        _setRoleAdmin(OPERATIONS_ROLE, SECURITY_ROLE);

        // Grant roles ONLY to the specified owner
        _grantRole(SECURITY_ROLE, initialOwner);
        _grantRole(OPERATIONS_ROLE, initialOwner);
    }

    /**
     * @dev Authorizes an upgrade to a new implementation.
     * Requirements:
     *   - Must be called through a proxy.
     *   - Caller must have SECURITY_ROLE.
     *
     * @param newImplementation The address of the new implementation contract.
     */
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyProxy onlyRole(SECURITY_ROLE) {}
}
