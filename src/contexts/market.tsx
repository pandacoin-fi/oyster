import React, { useCallback, useContext, useEffect, useState } from "react";
import { MINT_TO_MARKET } from "./../models/marketOverrides";
import {
  STABLE_COINS,
} from "./../utils/utils";
import { useConnectionConfig } from "./connection";
import {
  cache,
  getMultipleAccounts,
  MintParser,
  ParsedAccountBase,
} from "./accounts";
import { Market, MARKETS, Orderbook, TOKEN_MINTS } from "@project-serum/serum";
import { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import { useMemo } from "react";
import { EventEmitter } from "./../utils/eventEmitter";

export interface MarketsContextState {
  midPriceInUSD: (mint: string) => number;
  marketEmitter: EventEmitter;
  accountsToObserve: Map<string, number>;
  marketByMint: Map<string, SerumMarket>;

  subscribeToMarket: (mint: string) => () => void;
}

const REFRESH_INTERVAL = 30_000;

const MarketsContext = React.createContext<MarketsContextState | null>(null);

const marketEmitter = new EventEmitter();

export function MarketProvider({ children = null as any }) {
  const { endpoint } = useConnectionConfig();
  const accountsToObserve = useMemo(() => new Map<string, number>(), []);

  const connection = useMemo(() => new Connection(endpoint, "recent"), [
    endpoint,
  ]);

  // TODO: identify which markets to query ...
  const mints = useMemo(() => [] as PublicKey[], []);

  const marketByMint = useMemo(() => {
    return [
      ...new Set(mints).values(),
    ].reduce((acc, key) => {
      const mintAddress = key.toBase58();

      const SERUM_TOKEN = TOKEN_MINTS.find(
        (a) => a.address.toBase58() === mintAddress
      );

      const marketAddress = MINT_TO_MARKET[mintAddress];
      const marketName = `${SERUM_TOKEN?.name}/USDC`;
      const marketInfo = MARKETS.find(
        (m) => m.name === marketName || m.address.toBase58() === marketAddress
      );

      if (marketInfo) {
        acc.set(mintAddress, {
          marketInfo,
        });
      }

      return acc;
    }, new Map<string, SerumMarket>()) as Map<string, SerumMarket>;
  }, [mints]);

  useEffect(() => {
    let timer = 0;

    const updateData = async () => {
      await refreshAccounts(connection, [...accountsToObserve.keys()]);
      marketEmitter.raiseMarketUpdated(new Set([...marketByMint.keys()]));

      timer = window.setTimeout(() => updateData(), REFRESH_INTERVAL);
    };

    const initalQuery = async () => {
      const reverseSerumMarketCache = new Map<string, string>();
      [...marketByMint.keys()].forEach((mint) => {
        const m = marketByMint.get(mint);
        if (m) {
          reverseSerumMarketCache.set(m.marketInfo.address.toBase58(), mint);
        }
      });

      const allMarkets = [...marketByMint.values()].map((m) => {
        return m.marketInfo.address.toBase58();
      });

      await getMultipleAccounts(
        connection,
        // only query for markets that are not in cahce
        allMarkets.filter((a) => cache.get(a) === undefined),
        "single"
      ).then(({ keys, array }) => {
        allMarkets.forEach(() => {});

        return array.map((item, index) => {
          const marketAddress = keys[index];
          const mintAddress = reverseSerumMarketCache.get(marketAddress);
          if (mintAddress) {
            const market = marketByMint.get(mintAddress);

            if (market) {
              const programId = market.marketInfo.programId;
              const id = market.marketInfo.address;
              cache.add(id, item, (id, acc) => {
                const decoded = Market.getLayout(programId).decode(acc.data);

                const details = {
                  pubkey: id,
                  account: {
                    ...acc,
                  },
                  info: decoded,
                } as ParsedAccountBase;

                cache.registerParser(details.info.baseMint, MintParser);
                cache.registerParser(details.info.quoteMint, MintParser);
                cache.registerParser(details.info.bids, OrderBookParser);
                cache.registerParser(details.info.asks, OrderBookParser);

                return details;
              });
            }
          }

          return item;
        });
      });

      const toQuery = new Set<string>();
      allMarkets.forEach((m) => {
        const market = cache.get(m);
        if (!market) {
          return;
        }

        const decoded = market;

        if (!cache.get(decoded.info.baseMint)) {
          toQuery.add(decoded.info.baseMint.toBase58());
        }

        if (!cache.get(decoded.info.baseMint)) {
          toQuery.add(decoded.info.quoteMint.toBase58());
        }

        toQuery.add(decoded.info.bids.toBase58());
        toQuery.add(decoded.info.asks.toBase58());
      });

      await refreshAccounts(connection, [...toQuery.keys()]);

      marketEmitter.raiseMarketUpdated(new Set([...marketByMint.keys()]));

      // start update loop
      updateData();
    };

    initalQuery();

    return () => {
      window.clearTimeout(timer);
    };
  }, [marketByMint, accountsToObserve, connection]);

  const midPriceInUSD = useCallback(
    (mintAddress: string) => {
      return getMidPrice(
        marketByMint.get(mintAddress)?.marketInfo.address.toBase58(),
        mintAddress
      );
    },
    [marketByMint]
  );

  const subscribeToMarket = useCallback(
    (mintAddress: string) => {
      const info = marketByMint.get(mintAddress);
      const market = cache.get(info?.marketInfo.address.toBase58() || "");
      if (!market) {
        return () => {};
      }

      // TODO: get recent volume

      const bid = market.info.bids.toBase58();
      const ask = market.info.asks.toBase58();
      accountsToObserve.set(bid, (accountsToObserve.get(bid) || 0) + 1);
      accountsToObserve.set(ask, (accountsToObserve.get(ask) || 0) + 1);

      // TODO: add event queue to query for last trade

      return () => {
        accountsToObserve.set(bid, (accountsToObserve.get(bid) || 0) - 1);
        accountsToObserve.set(ask, (accountsToObserve.get(ask) || 0) - 1);

        // cleanup
        [...accountsToObserve.keys()].forEach((key) => {
          if ((accountsToObserve.get(key) || 0) <= 0) {
            accountsToObserve.delete(key);
          }
        });
      };
    },
    [marketByMint, accountsToObserve]
  );

  return (
    <MarketsContext.Provider
      value={{
        midPriceInUSD,
        marketEmitter,
        accountsToObserve,
        marketByMint,
        subscribeToMarket,
      }}
    >
      {children}
    </MarketsContext.Provider>
  );
}

export const useMarkets = () => {
  const context = useContext(MarketsContext);
  return context as MarketsContextState;
};

export const useMidPriceInUSD = (mint: string) => {
  const { midPriceInUSD, subscribeToMarket, marketEmitter } = useContext(
    MarketsContext
  ) as MarketsContextState;
  const [price, setPrice] = useState<number>(0);

  useEffect(() => {
    let subscription = subscribeToMarket(mint);
    const update = () => {
      if (midPriceInUSD) {
        setPrice(midPriceInUSD(mint));
      }
    };

    update();
    const dispose = marketEmitter.onMarket(update);

    return () => {
      subscription();
      dispose();
    };
  }, [midPriceInUSD, mint, marketEmitter, subscribeToMarket]);

  return { price, isBase: price === 1.0 };
};

const OrderBookParser = (id: PublicKey, acc: AccountInfo<Buffer>) => {
  const decoded = Orderbook.LAYOUT.decode(acc.data);

  const details = {
    pubkey: id,
    account: {
      ...acc,
    },
    info: decoded,
  } as ParsedAccountBase;

  return details;
};

const getMidPrice = (marketAddress?: string, mintAddress?: string) => {
  const SERUM_TOKEN = TOKEN_MINTS.find(
    (a) => a.address.toBase58() === mintAddress
  );

  if (STABLE_COINS.has(SERUM_TOKEN?.name || "")) {
    return 1.0;
  }

  if (!marketAddress) {
    return 0.0;
  }

  const marketInfo = cache.get(marketAddress);
  if (!marketInfo) {
    return 0.0;
  }

  const decodedMarket = marketInfo.info;

  const baseMintDecimals =
    cache.get(decodedMarket.baseMint)?.info.decimals || 0;
  const quoteMintDecimals =
    cache.get(decodedMarket.quoteMint)?.info.decimals || 0;

  const market = new Market(
    decodedMarket,
    baseMintDecimals,
    quoteMintDecimals,
    undefined,
    decodedMarket.programId
  );

  const bids = cache.get(decodedMarket.bids)?.info;
  const asks = cache.get(decodedMarket.asks)?.info;

  if (bids && asks) {
    const bidsBook = new Orderbook(market, bids.accountFlags, bids.slab);
    const asksBook = new Orderbook(market, asks.accountFlags, asks.slab);

    const bestBid = bidsBook.getL2(1);
    const bestAsk = asksBook.getL2(1);

    if (bestBid.length > 0 && bestAsk.length > 0) {
      return (bestBid[0][0] + bestAsk[0][0]) / 2.0;
    }
  }

  return 0;
};

const refreshAccounts = async (connection: Connection, keys: string[]) => {
  if (keys.length === 0) {
    return [];
  }

  return getMultipleAccounts(connection, keys, "single").then(
    ({ keys, array }) => {
      return array.map((item, index) => {
        const address = keys[index];
        return cache.add(new PublicKey(address), item);
      });
    }
  );
};

interface SerumMarket {
  marketInfo: {
    address: PublicKey;
    name: string;
    programId: PublicKey;
    deprecated: boolean;
  };

  // 1st query
  marketAccount?: AccountInfo<Buffer>;

  // 2nd query
  mintBase?: AccountInfo<Buffer>;
  mintQuote?: AccountInfo<Buffer>;
  bidAccount?: AccountInfo<Buffer>;
  askAccount?: AccountInfo<Buffer>;
  eventQueue?: AccountInfo<Buffer>;

  swap?: {
    dailyVolume: number;
  };

  midPrice?: (mint?: PublicKey) => number;
}