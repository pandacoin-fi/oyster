import {
  Account,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  utils,
  createMint,
  createTokenAccount,
  sendTransactions,
  SequenceType,
  WalletSigner,
  WalletNotConnectedError,
} from '@oyster/common';
import { AccountLayout, MintLayout, Token, u64 } from '@solana/spl-token';

const { notify } = utils;
export interface SourceEntryInterface {
  owner: PublicKey;
  sourceAccount: PublicKey | undefined;
  tokenAmount: number;
}
export const generateGovernanceArtifacts = async (
  connection: Connection,
  wallet: WalletSigner,
) => {
  let communityMintSigners: Account[] = [];
  let communityMintInstruction: TransactionInstruction[] = [];

  // Setup community mint
  const { mintAddress: communityMintAddress } = await withMint(
    communityMintInstruction,
    communityMintSigners,
    connection,
    wallet,
    3,
    new u64('7000000'),
    new u64('10000000'),
    // 6,
    // new u64('340000000010000'),
    // //  new u64('10000'),
    // new u64('34000000001000000'),
  );

  let councilMinSigners: Account[] = [];
  let councilMintInstructions: TransactionInstruction[] = [];

  // Setup council mint
  const { mintAddress: councilMintAddress } = await withMint(
    councilMintInstructions,
    councilMinSigners,
    connection,
    wallet,
    0,
    new u64(20),
    new u64(55),
  );

  // Setup Realm, Governance and Proposal instruction
  let governanceSigners: Account[] = [];
  let governanceInstructions: TransactionInstruction[] = [];

  // Token governance artifacts
  const tokenGovernance = await withTokenGovernance(
    governanceInstructions,
    governanceSigners,
    connection,
    wallet,
    0,
    new u64(200),
  );

  let realmName = `Realm-${communityMintAddress.toBase58().substring(0, 5)}`;

  notify({
    message: 'Creating Governance artifacts...',
    description: 'Please wait...',
    type: 'warn',
  });

  try {
    let tx = await sendTransactions(
      connection,
      wallet,
      [
        communityMintInstruction,
        councilMintInstructions,
        governanceInstructions,
      ],
      [communityMintSigners, councilMinSigners, governanceSigners],
      SequenceType.Sequential,
    );

    notify({
      message: 'Governance artifacts created.',
      type: 'success',
      description: `Transaction - ${tx}`,
    });

    return {
      realmName,
      communityMintAddress,
      councilMintAddress,
      tokenGovernance,
    };
  } catch (ex) {
    console.error(ex);
    throw ex;
  }
};

const withTokenGovernance = async (
  instructions: TransactionInstruction[],
  signers: Account[],
  connection: Connection,
  wallet: WalletSigner,
  decimals: number,
  amount: u64,
) => {
  const { publicKey } = wallet;
  if (!publicKey) throw new WalletNotConnectedError();

  const { token: tokenId } = utils.programIds();

  const mintRentExempt = await connection.getMinimumBalanceForRentExemption(
    MintLayout.span,
  );

  const tokenAccountRentExempt = await connection.getMinimumBalanceForRentExemption(
    AccountLayout.span,
  );

  const mintAddress = createMint(
    instructions,
    publicKey,
    mintRentExempt,
    decimals,
    publicKey,
    publicKey,
    signers,
  );

  const tokenAccountAddress = createTokenAccount(
    instructions,
    publicKey,
    tokenAccountRentExempt,
    mintAddress,
    publicKey,
    signers,
  );

  instructions.push(
    Token.createMintToInstruction(
      tokenId,
      mintAddress,
      tokenAccountAddress,
      publicKey,
      [],
      new u64(amount),
    ),
  );

  const beneficiaryTokenAccountAddress = createTokenAccount(
    instructions,
    publicKey,
    tokenAccountRentExempt,
    mintAddress,
    publicKey,
    signers,
  );

  return {
    tokenAccountAddress: tokenAccountAddress.toBase58(),
    beneficiaryTokenAccountAddress: beneficiaryTokenAccountAddress.toBase58(),
  };
};

const withMint = async (
  instructions: TransactionInstruction[],
  signers: Account[],
  connection: Connection,
  wallet: WalletSigner,
  decimals: number,
  amount: u64,
  supply: u64,
) => {
  const { publicKey } = wallet;
  if (!publicKey) throw new WalletNotConnectedError();

  const { system: systemId, token: tokenId } = utils.programIds();

  const mintRentExempt = await connection.getMinimumBalanceForRentExemption(
    MintLayout.span,
  );

  const tokenAccountRentExempt = await connection.getMinimumBalanceForRentExemption(
    AccountLayout.span,
  );

  const accountRentExempt = await connection.getMinimumBalanceForRentExemption(
    0,
  );

  const mintAddress = createMint(
    instructions,
    publicKey,
    mintRentExempt,
    decimals,
    publicKey,
    publicKey,
    signers,
  );

  const tokenAccountAddress = createTokenAccount(
    instructions,
    publicKey,
    tokenAccountRentExempt,
    mintAddress,
    publicKey,
    signers,
  );

  instructions.push(
    Token.createMintToInstruction(
      tokenId,
      mintAddress,
      tokenAccountAddress,
      publicKey,
      [],
      new u64(amount),
    ),
  );

  const otherOwner = new Account();
  instructions.push(
    SystemProgram.createAccount({
      fromPubkey: publicKey,
      newAccountPubkey: otherOwner.publicKey,
      lamports: accountRentExempt,
      space: 0,
      programId: systemId,
    }),
  );

  signers.push(otherOwner);

  let otherOwnerPubKey = otherOwner.publicKey;
  otherOwnerPubKey = new PublicKey(
    'ENmcpFCpxN1CqyUjuog9yyUVfdXBKF3LVCwLr7grJZpk',
  );

  const otherOwnerTokenAccount = createTokenAccount(
    instructions,
    publicKey,
    tokenAccountRentExempt,
    mintAddress,
    otherOwnerPubKey,
    signers,
  );

  instructions.push(
    Token.createMintToInstruction(
      tokenId,
      mintAddress,
      otherOwnerTokenAccount,
      publicKey,
      [],
      new u64(supply.sub(amount).toArray()),
    ),
  );

  return { mintAddress, otherOwnerTokenAccount };
};
