import { PublicKey } from "@solana/web3.js";
import { useMemo } from "react";
import { useMint } from "../contexts/accounts";
import { fromLamports } from "../utils/utils";
import { useUserAccounts } from "./useUserAccounts";

export function useUserBalance(mint?: PublicKey, inLamports = false) {
  const { userAccounts } = useUserAccounts();
  const mintInfo = useMint(mint);
  const accounts = useMemo(() => {
    return userAccounts
      .filter(acc => mint?.equals(acc.info.mint))
      .sort((a, b) => b.info.amount.sub(a.info.amount).toNumber());
  }, [userAccounts]);

  const balance = useMemo(() => {
    const result =  accounts
      .reduce((res, item) => res += item.info.amount.toNumber(), 0);
    return inLamports ? result : fromLamports(result , mintInfo);
  },[accounts, mintInfo]);

  return { balance, accounts };
}