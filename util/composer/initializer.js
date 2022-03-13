const hre = require('hardhat')
const storeComposer = require('./store')
const fakeTokenComposer = require('./token')
const fakeUniswapPairComposer = require('./uniswap-pair')
const libsComposer = require('./libs')
const { deployer, key, sample, helper, intermediate, fileCache } = require('..')
const { getNetworkInfo } = require('../network')
const { grantRoles } = require('./grant-roles')
const { minutesToBlocks } = require('../block-time')
const { getExternalProtocols } = require('./external-protocols')

/**
 * Initializes all contracts
 * @return {Promise<Contracts>}
 */
const initialize = async (suite, deploymentId) => {
  const chaindId = hre.network.config.chainId
  const [owner] = await ethers.getSigners()
  const cache = suite ? null : await fileCache.from(deploymentId)
  const network = await getNetworkInfo()
  const claimPeriod = network.cover.claimPeriod
  const cooldownPeriod = network.cover.cooldownPeriod
  const bondPeriod = network.pool.bond.period.toString()

  const tokens = await fakeTokenComposer.compose(cache)
  const { npm, dai, crpool, hwt, obk, sabre, bec, xd, aToken, cDai, tokenInfo } = tokens
  const { router, factory, aaveLendingPool, compoundDaiDelegator } = await getExternalProtocols(cache, tokens)

  const [pairs, pairInfo] = await fakeUniswapPairComposer.compose(cache, tokens)

  const [npmUsdPair, crpoolUsdPair, hwtUsdPair, obkUsdPair, sabreUsdPair, becUsdPair, xdUsdPair] = pairs

  // The protocol only supports stablecoin as reassurance token for now
  const reassuranceToken = dai

  const store = await storeComposer.deploy(cache)
  const libs = await libsComposer.deployAll(cache)

  const protocol = await deployer.deployWithLibraries(cache, 'Protocol',
    {
      AccessControlLibV1: libs.accessControlLibV1.address,
      BaseLibV1: libs.baseLibV1.address,
      ProtoUtilV1: libs.protoUtilV1.address,
      StoreKeyUtil: libs.storeKeyUtil.address,
      ValidationLibV1: libs.validationLib.address
    },
    store.address
  )

  await intermediate(cache, store, 'setBool', key.qualify(protocol.address), true)
  await intermediate(cache, store, 'setBool', key.qualifyMember(protocol.address), true)

  await grantRoles(intermediate, cache, protocol)

  await intermediate(cache, protocol, 'initialize',
    [helper.zero1,
      router,
      factory,
      npm.address,
      sample.fake.TREASURY,
      sample.fake.REASSURANCE_VAULT],
    [helper.ether(0), // Cover Fee
      helper.ether(0), // Min Cover Stake
      helper.ether(250), // Min Reporting Stake
      claimPeriod,
      helper.percentage(30), // Governance Burn Rate: 30%
      helper.percentage(10), // Governance Reporter Commission: 10%
      helper.percentage(6.5), // Claim: Platform Fee: 6.5%
      helper.percentage(5), // Claim: Reporter Commission: 5%
      helper.percentage(0.5), // Flash Loan Fee: 0.5%
      helper.percentage(2.5), // Flash Loan Protocol Fee: 2.5%
      cooldownPeriod
    ]
  )

  const bondPoolContract = await deployer.deployWithLibraries(cache, 'BondPool', {
    AccessControlLibV1: libs.accessControlLibV1.address,
    BondPoolLibV1: libs.bondPoolLibV1.address,
    BaseLibV1: libs.baseLibV1.address,
    PriceLibV1: libs.priceLibV1.address,
    ValidationLibV1: libs.validationLib.address
  }, store.address)

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.BOND_POOL, bondPoolContract.address)

  await intermediate(cache, npm, 'approve', bondPoolContract.address, helper.ether(2_000_000))
  let addresses = [npmUsdPair.address, sample.fake.TREASURY]
  let values = [helper.percentage(0.75), helper.ether(10_000), bondPeriod, helper.ether(2_000_000)]

  await intermediate(cache, bondPoolContract, 'setup', addresses, values)

  const stakingPoolContract = await deployer.deployWithLibraries(cache, 'StakingPools', {
    AccessControlLibV1: libs.accessControlLibV1.address,
    BaseLibV1: libs.baseLibV1.address,
    StakingPoolCoreLibV1: libs.stakingPoolCoreLibV1.address,
    StakingPoolLibV1: libs.stakingPoolLibV1.address,
    StoreKeyUtil: libs.storeKeyUtil.address,
    ValidationLibV1: libs.validationLib.address
  }, store.address)

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.STAKING_POOL, stakingPoolContract.address)

  // @todo: only applicable to testnet
  await intermediate(cache, crpool, 'approve', stakingPoolContract.address, helper.ether(13_400_300))
  addresses = [npm.address, npmUsdPair.address, crpool.address, crpoolUsdPair.address]
  values = [helper.ether(100_000_000), helper.ether(10_000), helper.percentage(0.25), 149953000, minutesToBlocks(chaindId, 5), helper.ether(13_400_300)]
  await intermediate(cache, stakingPoolContract, 'addOrEditPool', key.toBytes32('Crpool'), 'Crystalpool Staking', 0, addresses, values)

  await intermediate(cache, hwt, 'approve', stakingPoolContract.address, helper.ether(33_303_000))
  addresses = [npm.address, npmUsdPair.address, hwt.address, hwtUsdPair.address]
  values = [helper.ether(100_000_000), helper.ether(10_000), helper.percentage(0.25), 123480000, minutesToBlocks(chaindId, 5), helper.ether(33_303_000)]
  await intermediate(cache, stakingPoolContract, 'addOrEditPool', key.toBytes32('Huobi'), 'Huobi Staking', 0, addresses, values)

  await intermediate(cache, obk, 'approve', stakingPoolContract.address, helper.ether(12_30_330))
  addresses = [npm.address, npmUsdPair.address, obk.address, obkUsdPair.address]
  values = [helper.ether(100_000_000), helper.ether(50_000), helper.percentage(0.25), 154505290000, minutesToBlocks(chaindId, 5), helper.ether(12_30_330)]
  await intermediate(cache, stakingPoolContract, 'addOrEditPool', key.toBytes32('OBK'), 'OBK Staking', 0, addresses, values)

  await intermediate(cache, sabre, 'approve', stakingPoolContract.address, helper.ether(62_000_000))
  addresses = [npm.address, npmUsdPair.address, sabre.address, sabreUsdPair.address]
  values = [helper.ether(100_000_000), helper.ether(100_000), helper.percentage(0.25), 194033000001, minutesToBlocks(chaindId, 5), helper.ether(62_000_000)]
  await intermediate(cache, stakingPoolContract, 'addOrEditPool', key.toBytes32('SABRE'), 'SABRE Staking', 0, addresses, values)

  await intermediate(cache, bec, 'approve', stakingPoolContract.address, helper.ether(52_000_000))
  addresses = [npm.address, npmUsdPair.address, bec.address, becUsdPair.address]
  values = [helper.ether(100_000_000), helper.ether(80_000), helper.percentage(0.25), 194033000001, minutesToBlocks(chaindId, 5), helper.ether(52_000_000)]
  await intermediate(cache, stakingPoolContract, 'addOrEditPool', key.toBytes32('BEC'), 'BEC Staking', 0, addresses, values)

  await intermediate(cache, xd, 'approve', stakingPoolContract.address, helper.ether(49_000_000))
  addresses = [npm.address, npmUsdPair.address, xd.address, xdUsdPair.address]
  values = [helper.ether(100_000_000), helper.ether(190_000), helper.percentage(0.25), 194033000004, minutesToBlocks(chaindId, 5), helper.ether(49_000_000)]
  await intermediate(cache, stakingPoolContract, 'addOrEditPool', key.toBytes32('XT'), 'XT Staking', 0, addresses, values)

  const stakingContract = await deployer.deployWithLibraries(cache, 'CoverStake', {
    AccessControlLibV1: libs.accessControlLibV1.address,
    BaseLibV1: libs.baseLibV1.address,
    CoverUtilV1: libs.coverUtilV1.address,
    RoutineInvokerLibV1: libs.RoutineInvokerLibV1.address,
    NTransferUtilV2: libs.transferLib.address,
    ProtoUtilV1: libs.protoUtilV1.address,
    StoreKeyUtil: libs.storeKeyUtil.address,
    ValidationLibV1: libs.validationLib.address
  }, store.address)

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.COVER_STAKE, stakingContract.address)

  const reassuranceContract = await deployer.deployWithLibraries(cache, 'CoverReassurance', {
    AccessControlLibV1: libs.accessControlLibV1.address,
    BaseLibV1: libs.baseLibV1.address,
    CoverUtilV1: libs.coverUtilV1.address,
    RoutineInvokerLibV1: libs.RoutineInvokerLibV1.address,
    NTransferUtilV2: libs.transferLib.address,
    ProtoUtilV1: libs.protoUtilV1.address,
    StoreKeyUtil: libs.storeKeyUtil.address,
    ValidationLibV1: libs.validationLib.address
  }, store.address)

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.COVER_REASSURANCE, reassuranceContract.address)

  const vaultFactory = await deployer.deployWithLibraries(cache, 'VaultFactory',
    {
      AccessControlLibV1: libs.accessControlLibV1.address,
      BaseLibV1: libs.baseLibV1.address,
      ProtoUtilV1: libs.protoUtilV1.address,
      ValidationLibV1: libs.validationLib.address,
      VaultFactoryLibV1: libs.vaultFactoryLib.address
    }
    , store.address
  )

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.COVER_VAULT_FACTORY, vaultFactory.address)

  const cxTokenFactory = await deployer.deployWithLibraries(cache, 'cxTokenFactory',
    {
      AccessControlLibV1: libs.accessControlLibV1.address,
      BaseLibV1: libs.baseLibV1.address,
      cxTokenFactoryLibV1: libs.cxTokenFactoryLib.address,
      ProtoUtilV1: libs.protoUtilV1.address,
      StoreKeyUtil: libs.storeKeyUtil.address,
      ValidationLibV1: libs.validationLib.address
    }
    , store.address
  )

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.COVER_CXTOKEN_FACTORY, cxTokenFactory.address)

  const governance = await deployer.deployWithLibraries(cache, 'Governance',
    {
      AccessControlLibV1: libs.accessControlLibV1.address,
      BaseLibV1: libs.baseLibV1.address,
      CoverUtilV1: libs.coverUtilV1.address,
      GovernanceUtilV1: libs.governanceLib.address,
      NTransferUtilV2: libs.transferLib.address,
      ProtoUtilV1: libs.protoUtilV1.address,
      RegistryLibV1: libs.registryLibV1.address,
      StoreKeyUtil: libs.storeKeyUtil.address,
      ValidationLibV1: libs.validationLib.address
    },
    store.address
  )

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.GOVERNANCE, governance.address)

  const resolution = await deployer.deployWithLibraries(cache, 'Resolution',
    {
      AccessControlLibV1: libs.accessControlLibV1.address,
      BaseLibV1: libs.baseLibV1.address,
      RoutineInvokerLibV1: libs.RoutineInvokerLibV1.address,
      StoreKeyUtil: libs.storeKeyUtil.address,
      ProtoUtilV1: libs.protoUtilV1.address,
      CoverUtilV1: libs.coverUtilV1.address,
      NTransferUtilV2: libs.transferLib.address,
      ValidationLibV1: libs.validationLib.address,
      GovernanceUtilV1: libs.governanceLib.address
    },
    store.address
  )

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.GOVERNANCE_RESOLUTION, resolution.address)

  const cover = await deployer.deployWithLibraries(cache, 'Cover',
    {
      AccessControlLibV1: libs.accessControlLibV1.address,
      BaseLibV1: libs.baseLibV1.address,
      CoverLibV1: libs.coverLibV1.address,
      ProtoUtilV1: libs.protoUtilV1.address,
      StoreKeyUtil: libs.storeKeyUtil.address,
      ValidationLibV1: libs.validationLib.address
    },
    store.address
  )

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.COVER, cover.address)

  const provisionContract = await deployer.deployWithLibraries(cache, 'CoverProvision', {
    AccessControlLibV1: libs.accessControlLibV1.address,
    BaseLibV1: libs.baseLibV1.address,
    CoverLibV1: libs.coverLibV1.address,
    StoreKeyUtil: libs.storeKeyUtil.address,
    ValidationLibV1: libs.validationLib.address
  }, store.address)

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.NS.COVER_PROVISION, provisionContract.address)

  const policyAdminContract = await deployer.deployWithLibraries(cache, 'PolicyAdmin', {
    AccessControlLibV1: libs.accessControlLibV1.address,
    BaseLibV1: libs.baseLibV1.address,
    PolicyHelperV1: libs.policyHelperV1.address,
    RoutineInvokerLibV1: libs.RoutineInvokerLibV1.address,
    StoreKeyUtil: libs.storeKeyUtil.address,
    ValidationLibV1: libs.validationLib.address
  }, store.address)

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.COVER_POLICY_ADMIN, policyAdminContract.address)

  await intermediate(cache, protocol, 'grantRole', key.ACCESS_CONTROL.COVER_MANAGER, owner.address)
  await intermediate(cache, cover, 'updateCoverCreatorWhitelist', owner.address, true)

  const policy = await deployer.deployWithLibraries(cache, 'Policy', {
    AccessControlLibV1: libs.accessControlLibV1.address,
    BaseLibV1: libs.baseLibV1.address,
    CoverUtilV1: libs.coverUtilV1.address,
    PolicyHelperV1: libs.policyHelperV1.address,
    ValidationLibV1: libs.validationLib.address
  }, store.address)

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.COVER_POLICY, policy.address)

  const claimsProcessor = await deployer.deployWithLibraries(cache, 'Processor',
    {
      AccessControlLibV1: libs.accessControlLibV1.address,
      BaseLibV1: libs.baseLibV1.address,
      GovernanceUtilV1: libs.governanceLib.address,
      RoutineInvokerLibV1: libs.RoutineInvokerLibV1.address,
      NTransferUtilV2: libs.transferLib.address,
      ProtoUtilV1: libs.protoUtilV1.address,
      RegistryLibV1: libs.registryLibV1.address,
      StoreKeyUtil: libs.storeKeyUtil.address,
      ValidationLibV1: libs.validationLib.address
    },
    store.address
  )

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.CLAIM_PROCESSOR, claimsProcessor.address)

  const liquidityEngine = await deployer.deployWithLibraries(cache, 'LiquidityEngine', {
    AccessControlLibV1: libs.accessControlLibV1.address,
    BaseLibV1: libs.baseLibV1.address,
    StrategyLibV1: libs.strategyLibV1.address,
    ValidationLibV1: libs.validationLib.address
  }, store.address)

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.LIQUIDITY_ENGINE, liquidityEngine.address)

  await intermediate(cache, liquidityEngine, 'setLendingPeriods', key.toBytes32(''), network.cover.lendingPeriod, network.cover.withdrawalWindow)

  if (aaveLendingPool) {
    const aaveStrategy = await deployer.deployWithLibraries(cache, 'AaveStrategy', {
      AccessControlLibV1: libs.accessControlLibV1.address,
      BaseLibV1: libs.baseLibV1.address,
      NTransferUtilV2: libs.transferLib.address,
      ProtoUtilV1: libs.protoUtilV1.address,
      RegistryLibV1: libs.registryLibV1.address,
      StoreKeyUtil: libs.storeKeyUtil.address,
      ValidationLibV1: libs.validationLib.address
    }, store.address, aaveLendingPool, aToken.address)

    await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.STRATEGY_AAVE, aaveStrategy.address)
    await intermediate(cache, liquidityEngine, 'addStrategies', [aaveStrategy.address])
  }

  const compoundStrategy = await deployer.deployWithLibraries(cache, 'CompoundStrategy', {
    AccessControlLibV1: libs.accessControlLibV1.address,
    BaseLibV1: libs.baseLibV1.address,
    NTransferUtilV2: libs.transferLib.address,
    ProtoUtilV1: libs.protoUtilV1.address,
    RegistryLibV1: libs.registryLibV1.address,
    StoreKeyUtil: libs.storeKeyUtil.address,
    ValidationLibV1: libs.validationLib.address
  }, store.address, compoundDaiDelegator, cDai.address)

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.STRATEGY_COMPOUND, compoundStrategy.address)
  await intermediate(cache, liquidityEngine, 'addStrategies', [compoundStrategy.address])

  const priceDiscovery = await deployer.deployWithLibraries(cache, 'PriceDiscovery', {
    AccessControlLibV1: libs.accessControlLibV1.address,
    BaseLibV1: libs.baseLibV1.address,
    PriceLibV1: libs.priceLibV1.address,
    ProtoUtilV1: libs.protoUtilV1.address,
    ValidationLibV1: libs.validationLib.address
  }, store.address)

  await intermediate(cache, protocol, 'addContract', key.PROTOCOL.CNS.PRICE_DISCOVERY, priceDiscovery.address)

  await intermediate(cache, cover, 'initialize', dai.address, key.toBytes32('DAI'))

  await intermediate(cache, policyAdminContract, 'setPolicyRates', helper.percentage(7), helper.percentage(45))

  return {
    intermediate,
    cache,
    store,
    npm,
    dai,
    crpool,
    hwt,
    obk,
    sabre,
    bec,
    xd,
    npmUsdPair,
    crpoolUsdPair,
    hwtUsdPair,
    obkUsdPair,
    sabreUsdPair,
    becUsdPair,
    xdUsdPair,
    reassuranceToken,
    protocol,
    stakingContract,
    reassuranceContract,
    provisionContract,
    vaultFactory,
    cxTokenFactory,
    cover,
    liquidityEngine,
    priceDiscovery,
    policyAdminContract,
    policy,
    governance,
    resolution,
    claimsProcessor,
    bondPoolContract,
    stakingPoolContract,
    libs,
    tokenInfo,
    pairInfo
  }
}

module.exports = { initialize }
