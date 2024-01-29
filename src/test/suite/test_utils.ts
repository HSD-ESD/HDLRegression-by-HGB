// specific imports
import { HDLRegressionTestController } from "../../HDLRegression/HDLRegressionTestController";

// general imports
import * as vscode from 'vscode';

// variables
let HDLRegressionByHGB : HDLRegressionTestController;

export async function getExtension() : Promise<HDLRegressionTestController | undefined>
{
    if (!HDLRegressionByHGB)
    {
        const extension = vscode.extensions.getExtension('p2l2.hdlregression-by-hgb');

        if (!extension)
        {
            return undefined;
        }

        if (!extension.isActive)
        {
            HDLRegressionByHGB = await extension.activate();
        }
        else
        {
            HDLRegressionByHGB = extension.exports;
        }
    }

    return HDLRegressionByHGB;
}