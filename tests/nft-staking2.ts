import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { NftStaking2 } from "../target/types/nft_staking2";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount, getAssociatedTokenAddress, getAssociatedTokenAddressSync, createAssociatedTokenAccount } from "@solana/spl-token";
import { assert, expect } from "chai";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from 'fs';
function functionalIncludes<T>(l: T[], f: (t: T) => boolean): boolean {
  for (const item of l){
    if (f(item)) return true;
  }
  return false;
}
function getIndex<T>(l: T[], f: (t: T) => boolean): number {
  for (let i = 0; i < l.length; i++) {
    if (f(l[i])) return i;
  }
  return -1;
}
async function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  })
}

describe("nft-staking2", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();

  anchor.setProvider(provider);
  const program = anchor.workspace.NftStaking2 as Program<NftStaking2>;
  const wallet = provider.wallet as anchor.Wallet;

  const [programTokenAccount] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("mint")],
    program.programId,
  );
  const [programAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("auth")],
    program.programId,
  );
  let mint: PublicKey;
  const setupToken = async () => {
    const m = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6
    );
    mint = m;
    const userTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      m,
      wallet.publicKey,
    )
    await mintTo(
      provider.connection,
      wallet.payer,
      m,
      userTokenAccount,
      wallet.payer,
      100000 * 10**6
    )
  }
  const initialize = async () => {
    const tx = await program.methods.initialize().accounts({
      programTokenAccount,
      mint,
      programAuthority,
    }).rpc();
  }
  it("Is initialized!", async () => {
    await setupToken();
    await initialize();
    const progAccountData = await getAccount(provider.connection, programTokenAccount);
    assert(progAccountData.amount === BigInt(0), "Program account has token");
    const userTokenAccount = getAssociatedTokenAddressSync(mint, wallet.publicKey);
    const userTokenAccountData = await getAccount(provider.connection, userTokenAccount);
    assert(userTokenAccountData.amount === BigInt(100000 * 10**6), "user did not get token");
  });
  it("funds program account successfully", async () => {
    const userTokenAccount = getAssociatedTokenAddressSync(mint, wallet.publicKey);
    let amount = 50000 * 10**6;
    await program.methods.fund(new anchor.BN(amount)).accounts({
      userTokenAccount,
      user: wallet.publicKey,
      programTokenAccount,
    }).rpc();
    let programTokenAccountData = await getAccount(provider.connection, programTokenAccount);
    assert(programTokenAccountData.amount === BigInt(amount), "program token account did not get token");
    let userTokenAccountData = await getAccount(provider.connection, userTokenAccount);
    assert(userTokenAccountData.amount === BigInt(amount), "user token account has wrong amount of token");
  })
  it("can create and view account info", async () => {
    let user = Keypair.generate();
    const tx = await provider.connection.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL);
    await timeout(1000);
    let userTokenAccount = getAssociatedTokenAddressSync(
      mint,
      user.publicKey
    );
    let accountInfo = await provider.connection.getAccountInfo(userTokenAccount);
    assert(!accountInfo, "account defined");
    await program.methods.createAssociatedTokenAccount().accounts({
      user: user.publicKey,
      mint,
      associatedTokenAccount: userTokenAccount
    }).signers([user]).rpc();
    accountInfo = await provider.connection.getAccountInfo(userTokenAccount);
    assert(accountInfo, "account not defined");
  })
  const mintNFT = async () => {
    const nftMint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      0
    );
    const nftAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      nftMint,
      wallet.publicKey,
    );
    await mintTo(
      provider.connection,
      wallet.payer,
      nftMint,
      nftAccount.address,
      wallet.payer,
      1
    );
    const [stakeAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("stake"), wallet.publicKey.toBuffer()],
      program.programId,
    );
    const [stakeTokenAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("stake_account"), wallet.publicKey.toBuffer(), nftMint.toBuffer()],
      program.programId,
    )
    return { nftMint, nftAccount, stakeAccount, stakeTokenAccount };
  }
  const stake = async (size: number) => {
    const { nftMint, nftAccount, stakeAccount, stakeTokenAccount } = await mintNFT();
    await program.methods.stake(0, new anchor.BN(size)).accounts({
      stakeAccount,
      stakeTokenAccount,
      user: wallet.publicKey,
      nftAccount: nftAccount.address,
      programAuthority,
      mint: nftMint
    }).signers([wallet.payer]).rpc();
    return { nftMint, nftAccount, stakeAccount, stakeTokenAccount };
  }
  it("can stake single nft", async () => {
    const { nftMint, nftAccount, stakeAccount, stakeTokenAccount } = await mintNFT();
    await program.methods.stake(0, new anchor.BN(0)).accounts({
      stakeAccount,
      stakeTokenAccount,
      user: wallet.publicKey,
      nftAccount: nftAccount.address,
      programAuthority,
      mint: nftMint
    }).signers([wallet.payer]).rpc();
    // const account = await program.account.stakeInfo.fetch(stakeAccount);
    // console.log(account);
  });
  // it("should fail to stake if incorrect size", async () => {
  //     await fail(async () => {
  //       await stake(10)
  //     }, "Invalid size")
  // })
  it("can stake multiple nfts", async () =>{
    const [stakeAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("stake"), wallet.publicKey.toBuffer()],
      program.programId,
    );
    const accountInfo = await provider.connection.getAccountInfo(stakeAccount);
    await stake(1);
    await stake(2);
  });
  it("fails when smaller number is passed in", async () => {
    try {
      await stake(1);
      throw Error("Code succeeded");
    } catch (e) {
      //console.error(e);
    }
  });
  it("stakes and unstakes", async () => {
    let [stakeAccount] = anchor.web3.PublicKey.findProgramAddressSync(
       [Buffer.from("stake"), wallet.publicKey.toBuffer()],
       program.programId
     );
     const accountData = await program.account.stakeInfo.fetch(stakeAccount);
     const { nftMint } = await stake(accountData.mints.length);
     await stake(accountData.mints.length + 1);
     const accountData2 = await program.account.stakeInfo.fetch(stakeAccount);
     const accountDataAfter = await program.account.stakeInfo.fetch(stakeAccount);
     assert(accountDataAfter.mints.length > accountData.mints.length);
    const [stakeTokenAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("stake_account"), wallet.publicKey.toBuffer(), nftMint.toBuffer()],
      program.programId
    );
    const userTokenAccount = getAssociatedTokenAddressSync(
      mint, 
      wallet.publicKey
    );
    const nftAccount = getAssociatedTokenAddressSync(nftMint, wallet.publicKey);
    // const programBalance = await getAccount(provider.connection, programTokenAccount);
    // console.log(programBalance.amount);
    const accounts = (await program.account.stakeInfo.all())[0];
    const myIndex = getIndex(accounts.account.mints, (m) => m.equals(nftMint));
    const now = Date.now();
    const diff = BigInt(now) - BigInt(accounts.account.stakedTimes[myIndex].toString()) * BigInt(1000)
    // console.log({myIndex, time: accounts.account.stakedTimes[myIndex].toString(), diff})
    await program.methods.unstake().accounts({
      stakeAccount,
      stakeTokenAccount,
      nftAccount,
      programAuthority,
      programTokenAccount,
      user: wallet.publicKey,
      userTokenAccount,
    }).signers([wallet.payer]).rpc();
    await timeout(500);
    const token = await getAccount(provider.connection, userTokenAccount);
    assert(token.amount > 0, "user did not get any token");
    const tokenAcc = await getAccount(provider.connection, stakeTokenAccount);
    assert(tokenAcc.amount === BigInt(0), "Program still has nft token");
    const account = await program.account.stakeInfo.fetch(stakeAccount);
    fs.writeFileSync("file.json", JSON.stringify({account, accountData, accountData2, nftMint, nftAccount}));
    assert(account.mints.length === accountData.mints.length + 1, "did not stake 2 then unstake 1 nft");
    assert(account.mints.length === accountData2.mints.length - 1, "Removed a mint");
    assert(!functionalIncludes(account.mints, (mint) => {
      return mint.equals(nftMint);
    }), "Account still includes nft mint");
  });
  it("claims multiple", async () => {
    let [stakeAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("stake"), wallet.publicKey.toBuffer()],
      program.programId
    );
    const [programAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("auth")],
      program.programId,
    );
    let accountData = await program.account.stakeInfo.fetch(stakeAccount);
    let start = accountData.mints.length;
    for (let i = 0; i < 3; i++) {
      await stake(start + i);
    }
    const userTokenAccount = getAssociatedTokenAddressSync(
      mint, 
      wallet.publicKey
    );
    await program.methods.claim().accounts({
      stakeAccount,
      user: wallet.publicKey,
      userTokenAccount,
      programTokenAccount,
    }).rpc();
    accountData = await program.account.stakeInfo.fetch(stakeAccount);
    const bigints = accountData.stakedTimes.map((d) => BigInt(d.toString()));
    const bools = bigints.reduce((prev, curr) => {
      return [curr, prev[1] && prev[0] == curr]
    }, [bigints[0], true])
    assert(bools, "everything not equal");
  })
});
