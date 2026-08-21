Q6. incur it is

Q7. ok no file, it's more secure. It can be provided as an ENV var I guess

Q8. HITL is not an option. Agreed with (a) and (b)

Q9. agreed. we could even implement a fallback RPC if it doesn't complicate things too much.

Q10. yes (ii). Touching on dependencies, we will likely have a dependency on `@kleros/kleros-sdk` to get the v2 contracts we need easily. Here is an example: @../agentkit/v2-contracts-example/main-beta.ts

Q11. I've been considering a PRIVATE_KEY env var which seems more secure than a plain `0600` file. I also considered `cast wallet` encrypted keystore but for non-interactive use, the passphrase must still be provided somehow, so it doesn't seem much more secure. I'll likely consider importing the private key to CDP or to a [Web3Signer](https://github.com/Consensys/web3signer) service.

Question for you: how did you find out about `kleros-draw-monitor.mjs` ? I don't remember mentioning it.
