import ethers from 'ethers';
import express from 'express';
import chalk from 'chalk';
import dotenv from 'dotenv';
import inquirer from 'inquirer';
import http from 'http';
import axios from 'axios';
import querystring from 'querystring';
import filters from './filters.js';
import fs from 'fs';

const app = express();
dotenv.config();

const data = {
  WMATIC: process.env.WMATIC_CONTRACT.toLowerCase(), //wmatic

  USDC: process.env.USDC_CONTRACT.toLowerCase(), //busd

  WETH: process.env.WETH_CONTRACT.toLowerCase(), //busd

  to_PURCHASE: process.env.TO_PURCHASE, // token that you will purchase = BUSD for test '0xe9e7cea3dedca5984780bafc599bd69add087d56'

  AMOUNT_OF_WBNB : process.env.AMOUNT_OF_WBNB, // how much you want to buy in WBNB

  factory: process.env.FACTORY,  //QuickSwap factory

  router: process.env.ROUTER, //QuickSwap router

  recipient: process.env.YOUR_ADDRESS, //your wallet address,

  Slippage : process.env.SLIPPAGE, //in Percentage

  gasPrice : ethers.utils.parseUnits(`${process.env.GWEI}`, 'gwei'), //in gwei
  
  gasLimit : process.env.GAS_LIMIT, //at least 21000

  minMatic : process.env.MIN_LIQUIDITY_ADDED, //min liquidity added

  ownerBalanceMaxPercent : process.env.MAX_BALANCE_CREATOR_PERCENT
}

let initialLiquidityDetected = false;
let jmlBnb = 0;
let pairEvaluation = 0;

const bscMainnetUrl = 'https://rpc-mainnet.matic.quiknode.pro' //https://bsc-dataseed1.defibit.io/ https://bsc-dataseed.binance.org/
const wss = 'wss://matic-mainnet-full-ws.bwarelabs.com';
const mnemonic = process.env.YOUR_MNEMONIC //your memonic;
const tokenInWMATIC = data.WMATIC.toLowerCase();
const tokenInUSDC = data.USDC.toLowerCase();
const tokenInWETH = data.WETH.toLowerCase();
const tokenOut = data.to_PURCHASE;
const provider = new ethers.providers.JsonRpcProvider(bscMainnetUrl);
//const provider = new ethers.providers.WebSocketProvider(wss);
const wallet = new ethers.Wallet(mnemonic);
const account = wallet.connect(provider);
console.log(`chosen factory : ${data.factory}`);

 const factory = new ethers.Contract(
   data.factory,
   [
     'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
     'function getPair(address tokenA, address tokenB) external view returns (address pair)'
   ],
   account
 );

 const router = new ethers.Contract(
   data.router,
   [
     'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
     'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
     'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
   ],
   account
 );

 const erc = new ethers.Contract(
   data.WMATIC,
   [{"constant": true,"inputs": [{"name": "_owner","type": "address"}],"name": "balanceOf","outputs": [{"name": "balance","type": "uint256"}],"payable": false,"type": "function"}],
   account
 );

const run = async () => {
    //await checkLiq();
  console.log('starting to listen events...');
  await checkEventAddLiq();
}

  let checkEventAddLiq = async() => {
    let filter = {
      address: data.factory,
      topics: [
        ethers.utils.id("PairCreated(address,address,address,uint256)")
      ]
    }
    provider.on(filter, async (log, event) => {
      await analyzeToken(log);
    });
  }

  let analyzeToken = async(log) => {

    let pairCreated = {
      pairAddr: '0x' + log.data.substring(26, 66),
      txHash: log.transactionHash,
      creatorHolds: null,
      holdersCount: null,
      creatorHoldsLP: null,
      holdersCountLP: null,
      totalSupply: null
    }

    // get LP value
    pairCreated.pairMATICValue = await erc.balanceOf(pairCreated.pairAddr);
    pairCreated.LPValue = await ethers.utils.formatEther(pairCreated.pairMATICValue);

    /** @dev Filter minimum LP value in BNB
     */
        //if (!filters.LPMinValuePassed(pairCreated.LPValue, data.minMatic)) return;


    let newTokenAddr = (log.topics[1].includes(tokenInWMATIC.substring(2, 42)) ||
                        log.topics[1].includes(tokenInUSDC.substring(2,42)) ||
                        log.topics[1].includes(tokenInWETH       .substring(2,42))) ?
                          log.topics[2]:log.topics[1];
    pairCreated.newTokenAddr = '0x' + newTokenAddr.substring(26, 66);

    let txData = await provider.getTransaction(pairCreated.txHash);
    pairCreated.tokenCreator = txData.from.toLowerCase();

    [pairCreated.creatorHolds, pairCreated.holdersCount, pairCreated.creatorHoldsLP, pairCreated.holdersCountLP, pairCreated.totalSupply] =
        await filters.checkCreatorWallet(data, pairCreated);
    if (pairCreated.holdersCount <= 1) return;

    console.log(
        chalk.green.inverse(`\n\n\n\n                 New pair created                                  \n`)
        +
        `Pair infos :
      =================
      * Transaction receipt     : https://polygonscan.com/tx/${pairCreated.txHash},
      * Coin charts             : https://polygon.poocoin.app/tokens/${pairCreated.newTokenAddr},
      * LP Value                : ${pairCreated.LPValue} MATIC,
      * LP Pool address is      : ${pairCreated.pairAddr},
      * Token creator           : ${pairCreated.tokenCreator},
      * Creator has             : ${pairCreated.creatorHolds * 100}% of a total supply\`),
      * Liquidity - creator has : ${pairCreated.creatorHoldsLP * 100}% of a total supply\`),
      * Total Supply            : ${pairCreated.totalSupply},
      * Token holders count     : ${pairCreated.holdersCount};
    `);

    // Token evolution checker
    tokenEvolutionCheck(pairCreated).then(counter => {

      console.log(chalk.rgb(205, 255, 184).bgBlackBright.inverse(
          `Token ${pairCreated.newTokenAddr} has been successfully checked ${counter} times!!`))
    });


    // if(jmlBnb > data.minBnb) {
    //   setTimeout(() => buyAction(), 3000);
    // }
  }

  let tokenEvolutionCheck = async(pairCreated) => {
    let counter = 0;

    return await new Promise(resolve => {
      const interval = setInterval(async() => {

        [pairCreated.creatorHolds, pairCreated.holdersCount, pairCreated.creatorHoldsLP, pairCreated.holdersCountLP, pairCreated.totalSupply] =
            await filters.checkCreatorWallet(data, pairCreated);

        console.log(
            chalk.rgb(255, 192, 92).bgBlackBright.inverse(`\n\n\n\n                ${counter+1} : [${pairCreated.pairAddr}] : Recheck                                \n`)
            +
            `Pair infos :
            =================
              * Transaction receipt : https://polygonscan.com/tx/${pairCreated.txHash},
              * Coin charts         : https://polygon.poocoin.app/tokens/${pairCreated.newTokenAddr},
              * LP Value            : ${pairCreated.LPValue} MATIC,
              * LP Pool address is  : ${pairCreated.pairAddr},
              * Token creator       : ${pairCreated.tokenCreator},
              * Creator has         : ${pairCreated.creatorHolds * 100}% of a total supply\`),
              * Liquidity - creator has : ${pairCreated.creatorHoldsLP * 100}% of a total supply\`),
              * Total Supply        : ${pairCreated.totalSupply}
              * Token holders count : ${pairCreated.holdersCount};
        `);

        counter++;

        if (counter === 10) {
          if (pairCreated.holdersCount > 0) {
            fs.appendFile('./potentialTokens.json',JSON.stringify(pairCreated, null, 4) + ',\n', function (err) {
              if (err) throw err;
              console.log('Saved!');
            });
          }
          resolve(counter);
          clearInterval(interval);
        }
      }, 300000);
    });
  }

  /*let checkLiq = async() => {
    const pairAddressx = await factory.getPair(tokenInMatic, tokenOut);
    console.log(chalk.blue(`pairAddress: ${pairAddressx}`));
    if (pairAddressx !== null && pairAddressx !== undefined) {
      // console.log("pairAddress.toString().indexOf('0x0000000000000')", pairAddress.toString().indexOf('0x0000000000000'));
      if (pairAddressx.toString().indexOf('0x0000000000000') > -1) {
        console.log(chalk.cyan(`pairAddress ${pairAddressx} not detected. Auto restart`));
        return await run();
      }
    }
    const pairBNBvalue = await erc.balanceOf(pairAddressx);
    jmlBnb = await ethers.utils.formatEther(pairBNBvalue);
    console.log(`value BNB : ${jmlBnb}`);

    if(jmlBnb > data.minBnb){
        setTimeout(() => buyAction(), 3000);
    }
    else{
        initialLiquidityDetected = false;
        console.log(' run again...');
        return await run();
      }
  }

  let buyAction = async() => {
    if(initialLiquidityDetected === true) {
      console.log('not buy cause already buy');
        return null;
    }

    console.log('ready to buy');
    try{
      initialLiquidityDetected = true;

      let amountOutMin = 0;
      //We buy x amount of the new token for our wbnb
      const amountIn = ethers.utils.parseUnits(`${data.AMOUNT_OF_WBNB}`, 'ether');
      if ( parseInt(data.Slippage) !== 0 ){
        const amounts = await router.getAmountsOut(amountIn, [tokenInMatic, tokenOut]);
        //Our execution price will be a bit different, we need some flexbility
        const amountOutMin = amounts[1].sub(amounts[1].div(`${data.Slippage}`));
      }

      console.log(
       chalk.green.inverse(`Start to buy \n`)
        +
        `Buying Token
        =================
        tokenIn: ${(amountIn * 1e-18).toString()} ${tokenInMatic} (BNB)
        tokenOut: ${amountOutMin.toString()} ${tokenOut}
      `);

      console.log('Processing Transaction.....');
      console.log(chalk.yellow(`amountIn: ${(amountIn * 1e-18)} ${tokenInMatic} (BNB)`));
      console.log(chalk.yellow(`amountOutMin: ${amountOutMin}`));
      console.log(chalk.yellow(`tokenIn: ${tokenInMatic}`));
      console.log(chalk.yellow(`tokenOut: ${tokenOut}`));
      console.log(chalk.yellow(`data.recipient: ${data.recipient}`));
      console.log(chalk.yellow(`data.gasLimit: ${data.gasLimit}`));
      console.log(chalk.yellow(`data.gasPrice: ${data.gasPrice}`));

      const tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens( //uncomment this if you want to buy deflationary token
      // const tx = await router.swapExactTokensForTokens( //uncomment here if you want to buy token
        amountIn,
        amountOutMin,
        [tokenInMatic, tokenOut],
        data.recipient,
        Date.now() + 1000 * 60 * 5, //5 minutes
        {
          'gasLimit': data.gasLimit,
          'gasPrice': data.gasPrice,
            'nonce' : null //set you want buy at where position in blocks
      });

      const receipt = await tx.wait();
      console.log(`Transaction receipt : https://www.bscscan.com/tx/${receipt.logs[1].transactionHash}`);
      setTimeout(() => {process.exit()},2000);
    }catch(err){
      let error = JSON.parse(JSON.stringify(err));
        console.log(`Error caused by :
        {
        reason : ${error.reason},
        transactionHash : ${error.transactionHash}
        message : Please check your BNB/WBNB balance, maybe its due because insufficient balance or approve your token manually on pancakeSwap
        }`);
        console.log(error);

        inquirer.prompt([
    {
      type: 'confirm',
      name: 'runAgain',
      message: 'Do you want to run again thi bot?',
    },
  ])
  .then(answers => {
    if(answers.runAgain === true){
      console.log('= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =');
      console.log('Run again');
      console.log('= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =');
      initialLiquidityDetected = false;
      run();
    }else{
      process.exit();
    }

  });

    }
  }*/



// var init = function () {
//
//   provider.on("pending", (tx) => {
//     provider.getTransaction(tx).then(function (transaction) {
//       console.log(transaction);
//     });
//   });
//
//   provider._websocket.on("error", async () => {
//     console.log(`Unable to connect to ${ep.subdomain} retrying in 3s...`);
//     setTimeout(init, 3000);
//   });
//   provider._websocket.on("close", async (code) => {
//     console.log(
//         `Connection lost with code ${code}! Attempting reconnect in 3s...`
//     );
//     provider._websocket.terminate();
//     setTimeout(init, 3000);
//   });
// };



run();

const PORT = 5001;


let httpServer = http.createServer(app);
httpServer.listen('3333');
// Then close the server when done...
httpServer.close();
