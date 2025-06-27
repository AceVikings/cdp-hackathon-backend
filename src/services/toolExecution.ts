import { IApiTool } from "../models/apiTool.js";
import { ToolUsage } from "../models/toolUsage.js";
import { generateId } from "../utils/helpers.js";

export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  statusCode?: number;
  executionTime: number;
  toolId: string;
  billing: {
    costInWei: string;
    ethCost?: string;
  };
}

export class ToolExecutorService {
  async executeTool(
    tool: IApiTool,
    parameters: Record<string, any>,
    userId: string,
    sessionId: string
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    try {
      // Validate parameters
      const validationResult = this.validateParameters(tool, parameters);
      if (!validationResult.valid) {
        return {
          success: false,
          error: `Parameter validation failed: ${validationResult.errors.join(
            ", "
          )}`,
          executionTime: Date.now() - startTime,
          toolId: tool.toolId,
          billing: {
            costInWei: tool.pricing.costInWei,
            ethCost: tool.pricing.ethCost,
          },
        };
      }

      // Prepare API request (without authentication)
      const requestConfig = this.prepareRequest(tool, parameters);

      // Execute API call with retries
      const result = await this.executeWithRetries(
        requestConfig,
        tool.apiConfig.retries || 3
      );

      const executionTime = Date.now() - startTime;

      // Log usage with billing information
      await this.logToolUsage(
        tool.toolId,
        userId,
        sessionId,
        parameters,
        {
          success: true,
          data: result.data,
          statusCode: result.status,
          executionTime,
        },
        tool.pricing.costInWei
      );

      return {
        success: true,
        data: result.data,
        statusCode: result.status,
        executionTime,
        toolId: tool.toolId,
        billing: {
          costInWei: tool.pricing.costInWei,
          ethCost: tool.pricing.ethCost,
        },
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Log failed usage
      await this.logToolUsage(
        tool.toolId,
        userId,
        sessionId,
        parameters,
        {
          success: false,
          error: errorMessage,
          executionTime,
        },
        tool.pricing.costInWei
      );

      return {
        success: false,
        error: errorMessage,
        executionTime,
        toolId: tool.toolId,
        billing: {
          costInWei: tool.pricing.costInWei,
          ethCost: tool.pricing.ethCost,
        },
      };
    }
  }

  private validateParameters(
    tool: IApiTool,
    parameters: Record<string, any>
  ): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    for (const param of tool.parameters) {
      const value = parameters[param.name];

      // Check required parameters
      if (param.required && (value === undefined || value === null)) {
        errors.push(`Required parameter '${param.name}' is missing`);
        continue;
      }

      if (value !== undefined && value !== null) {
        // Type validation
        if (!this.validateType(value, param.type)) {
          errors.push(
            `Parameter '${param.name}' must be of type '${param.type}'`
          );
        }

        // Custom validation
        if (param.validation) {
          const validationErrors = this.validateConstraints(
            param.name,
            value,
            param.validation
          );
          errors.push(...validationErrors);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private validateType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number" && !isNaN(value);
      case "boolean":
        return typeof value === "boolean";
      case "object":
        return (
          typeof value === "object" && value !== null && !Array.isArray(value)
        );
      case "array":
        return Array.isArray(value);
      default:
        return true;
    }
  }

  private validateConstraints(
    paramName: string,
    value: any,
    validation: any
  ): string[] {
    const errors: string[] = [];

    if (validation.min !== undefined && value < validation.min) {
      errors.push(
        `Parameter '${paramName}' must be at least ${validation.min}`
      );
    }

    if (validation.max !== undefined && value > validation.max) {
      errors.push(`Parameter '${paramName}' must be at most ${validation.max}`);
    }

    if (validation.pattern && typeof value === "string") {
      const regex = new RegExp(validation.pattern);
      if (!regex.test(value)) {
        errors.push(
          `Parameter '${paramName}' must match pattern ${validation.pattern}`
        );
      }
    }
    console.log(validation, "Validatoin");
    if (validation.enum.length > 0 && !validation.enum.includes(value)) {
      errors.push(
        `Parameter '${paramName}' must be one of: ${validation.enum.join(", ")}`
      );
    }

    return errors;
  }

  private prepareRequest(tool: IApiTool, parameters: Record<string, any>) {
    const headers = {
      "Content-Type": "application/json",
      ...tool.apiConfig.headers,
    };

    // No authentication - removed authentication logic

    // Prepare body/query parameters based on method
    let url = tool.apiConfig.endpoint;
    let body: string | undefined = undefined;

    if (tool.apiConfig.method === "GET") {
      const queryParams = new URLSearchParams();
      Object.entries(parameters).forEach(([key, value]) => {
        queryParams.append(key, String(value));
      });
      url += url.includes("?") ? "&" : "?";
      url += queryParams.toString();
    } else {
      body = JSON.stringify(parameters);
    }

    return {
      url,
      method: tool.apiConfig.method,
      headers,
      body,
      timeout: tool.apiConfig.timeout || 30000,
    };
  }

  private async executeWithRetries(
    requestConfig: any,
    maxRetries: number
  ): Promise<any> {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          requestConfig.timeout
        );

        const response = await fetch(requestConfig.url, {
          method: requestConfig.method,
          headers: requestConfig.headers,
          body: requestConfig.body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        return { data, status: response.status };
      } catch (error) {
        lastError = error;

        if (attempt < maxRetries) {
          // Exponential backoff
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 1000)
          );
        }
      }
    }

    throw lastError;
  }

  private async logToolUsage(
    toolId: string,
    userId: string,
    sessionId: string,
    parameters: Record<string, any>,
    response: any,
    costInWei: string
  ) {
    try {
      const usage = new ToolUsage({
        toolId,
        userId,
        sessionId,
        parameters,
        response,
        billing: {
          costInWei,
          paid: false, // Will be updated when payment is processed
        },
      });
      await usage.save();
    } catch (error) {
      console.error("Failed to log tool usage:", error);
    }
  }

  // Helper method to convert wei to ETH for display
  static weiToEth(weiAmount: string): string {
    const wei = BigInt(weiAmount);
    const eth = Number(wei) / 1e18;
    return eth.toFixed(18).replace(/\.?0+$/, ""); // Remove trailing zeros
  }

  // Helper method to convert ETH to wei for storage
  static ethToWei(ethAmount: string | number): string {
    const eth =
      typeof ethAmount === "string" ? parseFloat(ethAmount) : ethAmount;
    const wei = BigInt(Math.floor(eth * 1e18));
    return wei.toString();
  }
}
