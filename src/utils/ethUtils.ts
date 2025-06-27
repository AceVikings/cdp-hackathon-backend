export class EthUtils {
  // Convert wei (string) to ETH (number) for display
  static weiToEth(weiAmount: string): number {
    return Number(BigInt(weiAmount)) / 1e18;
  }

  // Convert wei (string) to ETH (string) with specified decimals
  static weiToEthString(weiAmount: string, decimals: number = 6): string {
    const eth = this.weiToEth(weiAmount);
    return eth.toFixed(decimals).replace(/\.?0+$/, "");
  }

  // Convert ETH to wei (string)
  static ethToWei(ethAmount: string | number): string {
    const eth =
      typeof ethAmount === "string" ? parseFloat(ethAmount) : ethAmount;
    const wei = BigInt(Math.floor(eth * 1e18));
    return wei.toString();
  }

  // Format wei for display with units
  static formatWei(weiAmount: string): string {
    const eth = this.weiToEth(weiAmount);
    if (eth >= 1) {
      return `${this.weiToEthString(weiAmount)} ETH`;
    } else if (eth >= 0.001) {
      return `${(eth * 1000).toFixed(3)} mETH`;
    } else {
      return `${weiAmount} wei`;
    }
  }

  // Validate wei amount
  static isValidWei(weiAmount: string): boolean {
    try {
      const wei = BigInt(weiAmount);
      return wei >= 0n;
    } catch {
      return false;
    }
  }
}
