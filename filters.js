import querystring from "querystring";
import axios from "axios";

const filters = {




    // ADD polyscan nb contracts

    LPMinValuePassed: (value, minValue) => {
        console.log("LP Value filtering...");
        console.log(`value = ${value} BNB, minimum value = ${minValue}`);
        return value >= minValue;
    },

    checkCreatorWallet: async (data, pairCreated) => {

        const parameters = {
            key: 'ckey_66360f80fa6444babcebc84'
        }
        const get_request_args = querystring.stringify(parameters);
        let url =  'http://api.covalenthq.com/v1/137/tokens/'+ pairCreated.newTokenAddr + '/token_holders/?' + get_request_args;
        let urlLP =  'http://api.covalenthq.com/v1/137/tokens/'+ pairCreated.pairAddr + '/token_holders/?' + get_request_args;

        let creatorHolds = 0;
        let creatorHoldsLP = 0;
        let tokenHoldersCount = 0;
        let tokenHoldersCountLP = 0;
        let isFound;
        let isFoundLP;
        let totalSupply=0;
        try {
            const response = await axios.get(url);

            response.data.data.items.forEach(function(item) {
                //console.log(item);
            });

            const found = response.data.data.items.find(item => item.address === pairCreated.tokenCreator.toLowerCase());
            isFound = typeof found !== 'undefined';
            //console.log(`found? : ${isFound} ----- ${found}`);
            if (isFound) {

                // filter creator's balance
                creatorHolds = found.balance/found.total_supply;
                if (creatorHolds < data.ownerBalanceMaxPercent) {
                    //console.log("Creator's balance filter passed");
                    //return true;
                }

                // filter holders quantity (trop tôt je crois)
                //console.log(`This token has ${response.data.data.items.length} holders`);
                tokenHoldersCount = response.data.data.items.length;
                if (true) {
                    //console.log("Token holders quantity filter passed");

                }

                // filter total supply
                totalSupply = found.total_supply;

            }

            const responseLP = await axios.get(urlLP);
            const foundLP = responseLP.data.data.items.find(item => item.address === pairCreated.tokenCreator.toLowerCase());
            isFoundLP = typeof foundLP !== 'undefined';
            //console.log(`found? : ${isFound} ----- ${found}`);
            if (isFoundLP) {

                // filter creator's balance
                creatorHoldsLP = foundLP.balance/foundLP.total_supply;
                if (creatorHolds < data.ownerBalanceMaxPercent) {
                    //console.log("Creator's balance filter passed");
                    //return true;
                }

                // filter holders quantity (trop tôt je crois)
                //console.log(`This token has ${response.data.data.items.length} holders`);
                tokenHoldersCountLP = responseLP.data.data.items.length;
                if (true) {
                    //console.log("Token holders quantity filter passed");

                }
            }
        }
        catch(error) {
            console.log(error);
        }
        return [creatorHolds, tokenHoldersCount, creatorHoldsLP, tokenHoldersCountLP, totalSupply];
    }
}
export default filters;
