/** @jsxImportSource frog/jsx */
import { Button, Frog, TextInput } from 'frog'
import { devtools } from 'frog/dev'
import { neynar } from 'frog/hubs'
import { handle } from 'frog/next'
import { serveStatic } from 'frog/serve-static'

import { base } from 'viem/chains';
import { parseEther } from 'frog'

import {
  ActionType,
  ChainId,
  BoxActionRequest,
  EvmAddress,
  SwapDirection,
} from '@decent.xyz/box-common';

import {
  baseClient,
  erc20Abi,
  getUserBalance,
  getTokenWithMaxBalance,
  getTransactionData,
  getTransactionStatus
} from './decentUtils';

let chain = base;
let zeroAddress = '0x0000000000000000000000000000000000000000';

type State = {
  txHash: string | undefined,
  srcChain: number,
}

const app = new Frog<{ State: State }>({
  assetsPath: '/',
  basePath: '/api',
  // Supply a Hub to enable frame verification.
  hub: neynar({ apiKey: process.env.NEYNAR_API_KEY!! }),
  initialState: {
    txHash: undefined,
    srcChain: -1,
  },
})

// Uncomment to use Edge Runtime
// export const runtime = 'edge'

app.frame('/', async (c) => {
  return c.res({
    image: "https://daily.prohibition.art/nfts/amber.jpg",
    imageAspectRatio: '1:1',
    intents: [
      // action is the post_url override apparently according to Frames.Transaction documentation https://frog.fm/intents/button-transaction#action-optional
      <Button.Transaction target="/tx" action="/tx-success">Mint Now</Button.Transaction>,
      //<Button.Transaction target="/approve" action="/">Approve</Button.Transaction>,
    ],
  })
})

app.transaction('/tx', async (c) => {
  const account = c.address; // uses wallet connected to displayed Frame

  const tokens = await getUserBalance(chain.id, account);
  const sourceToken = await getTokenWithMaxBalance(chain.id, tokens, true, 25);

  // build decent.xyz transaction here and return it

  const txConfig: BoxActionRequest = {
    sender: account!,
    srcChainId: chain?.id as ChainId,
    dstChainId: ChainId.BASE,
    // srcToken: sourceToken,
    srcToken: '0x0000000000000000000000000000000000000000',
    dstToken: '0x0000000000000000000000000000000000000000',
    slippage: 1,
    actionType: ActionType.EvmFunction,
    actionConfig: {
      contractAddress: process.env.CONTRACT_ADDRESS as string,
      chainId: ChainId.BASE,
      signature: "function mint(address to,uint256 numberOfTokens)",
      args: [account, 1n],
      cost: {
        isNative: true,
        amount: parseEther('0.0016'),
        tokenAddress: '0x0000000000000000000000000000000000000000',
      },
    }
  }

  const { tx, tokenPayment } = await getTransactionData(txConfig);

  // check for allowance if non native.
  if (sourceToken !== zeroAddress) {
    const allowance = await baseClient.readContract({
      address: sourceToken as EvmAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [
        account as EvmAddress,
        tx.to as EvmAddress,
      ]
    });

    if (allowance < tokenPayment.amount) {
      // requires approval
      return c.error({ message: 'Requires approval' });
    }
  }

  return c.res({
    chainId: `eip155:${base.id}`,
    method: "eth_sendTransaction",
    params: {
      to: tx.to,
      data: tx.data,
      value: tx.value.toString(),
    },
  },)
})

app.transaction('/approve', async (c) => {
  const account = c.address; // uses wallet connected to displayed Frame

  // get the sourceToken. The token the user has the maximum balance in (or the native gas token if that has enough balance)
  const tokens = await getUserBalance(chain.id, account);
  const sourceToken = await getTokenWithMaxBalance(chain.id, tokens);

  // build decent.xyz transaction here and use the address it is sent to as the to address for the approve call

  const txConfig: BoxActionRequest = {
    sender: account!,
    srcChainId: chain?.id as ChainId,
    dstChainId: ChainId.BASE,
    srcToken: sourceToken,
    dstToken: '0x0000000000000000000000000000000000000000',
    slippage: 1,
    actionType: ActionType.EvmFunction,
    actionConfig: {
      contractAddress: process.env.CONTRACT_ADDRESS as string,
      chainId: ChainId.BASE,
      signature: "function mint(address to,uint256 numberOfTokens)",
      args: [account, 1n],
      cost: {
        isNative: true,
        amount: parseEther('0.0008'),
        tokenAddress: '0x0000000000000000000000000000000000000000',
      },
    }
  }

  const { tx, tokenPayment } = await getTransactionData(txConfig);

  // check for allowance if non native.

  if (sourceToken == zeroAddress) {
    return c.error({ message: 'You can mint right away. Press Mint Now!' });
  }

  const allowance = await baseClient.readContract({
    address: sourceToken as EvmAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [
      account as EvmAddress,
      tx.to as EvmAddress,
    ]
  });

  if (allowance >= tokenPayment.amount) {
    return c.error({ message: 'You can mint right away. Press Mint Now!' });
  }

  // requires approval
  return c.contract({
    abi: erc20Abi,
    chainId: `eip155:${chain.id}`,
    functionName: 'approve',
    to: sourceToken as EvmAddress,
    args: [
      tx.to,
      tokenPayment.amount
    ]
  })
});

app.frame('/tx-success', async (c) => {
  let { transactionId, deriveState } = c;

  let state: State;
  console.log('current transactionId', transactionId);
  state = deriveState(previousState => {
    previousState.txHash = transactionId;
    previousState.srcChain = chain.id;
  })

  console.log('Source Chain TX Hash:', transactionId, 'State: ', state)

  const { status, transactionHash } = await getTransactionStatus(state.srcChain, state.txHash!!);

  if (status === 'Executed') {
    console.log('Transaction has been executed successfully.');

    try {
      // do your custom logic on successful transaction here

      return c.res({
        image: "https://daily.prohibition.art/nfts/amber.jpg",
        imageAspectRatio: '1:1',
        intents: [
          <Button.Link href={`https://proxyswap.tips`}> Success, check proxyswap</Button.Link>,
        ],
      })

    } catch (err) {
      console.error('Error in our custom logic:', err);
    }
  } else if (status === 'Failed') {
    console.log('Transaction has failed.');

    // return a new frame where image shows failed
    return c.res({
      image: "https://daily.prohibition.art/nfts/amber.jpg",
      imageAspectRatio: '1:1',
      intents: [
        // action is the post_url override apparently according to Frames.Transaction documentation https://frog.fm/intents/button-transaction#action-optional
        <Button.Transaction target="/tx" action="/tx-success">Failed, Try again.</Button.Transaction>,
      ],
    })
  }

  return c.res({
    image: "https://daily.prohibition.art/nfts/amber.jpg",
    imageAspectRatio: '1:1',
    intents: [
      <Button action='/end'>Processing... Check Status</Button>,
    ],
  })
})

app.frame('/end', async (c) => {
  let { previousState } = c;

  console.log('State: ', previousState)

  const { status, transactionHash } = await getTransactionStatus(previousState.srcChain, previousState.txHash!!);

  if (status === 'Executed') {
    console.log('Transaction has been executed successfully.');

    try {
      // do your custom logic on successful transaction here

      return c.res({
        image: "https://daily.prohibition.art/nfts/amber.jpg",
        imageAspectRatio: '1:1',
        intents: [
          <Button.Link href={`https://daily.prohibition.art`}> Success, check it</Button.Link>,
        ],
      })

    } catch (err) {
      console.error('Error in our custom logic:', err);
    }
  } else if (status === 'Failed') {
    console.log('Transaction has failed.');

    // return a new frame where image shows failed
    return c.res({
      image: "https://daily.prohibition.art/nfts/amber.jpg",
      imageAspectRatio: '1:1',
      intents: [
        // action is the post_url override apparently according to Frames.Transaction documentation https://frog.fm/intents/button-transaction#action-optional
        <Button.Transaction target="/tx" action="/tx-success">Failed, try again</Button.Transaction>,
      ],
    })
  }

  return c.res({
    image: "https://daily.prohibition.art/nfts/amber.jpg",
    imageAspectRatio: '1:1',
    intents: [
      <Button action='/end'>Processing... Check Status</Button>,
    ],
  })
})

devtools(app, { serveStatic })

export const GET = handle(app)
export const POST = handle(app)
