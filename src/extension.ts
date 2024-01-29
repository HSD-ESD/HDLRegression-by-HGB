/*******************************************************************************
 *                                                                              *
 *  HDLRegression by HGB - HDLRegression-TestController for Visual-Studio-Code  *
 *                                                                              *
 *  Copyright (C) [2023] [jakobjung10]                                          *
 *                                                                              *
 *  This program is free software: you can redistribute it and/or modify        *
 *  it under the terms of the GNU General Public License as published by        *
 *  the Free Software Foundation, either version 3 of the License, or           *
 *  (at your option) any later version.                                         *
 *                                                                              *
 *  You should have received a copy of the GNU General Public License           *
 *  along with this program. If not, see <https://www.gnu.org/licenses/>.       *
 *                                                                              *
 *******************************************************************************/

import * as vscode from 'vscode';

import { HDLRegressionTestController } from './HDLRegression/HDLRegressionTestController';

let testController : HDLRegressionTestController;

export async function activate(context: vscode.ExtensionContext) : Promise<HDLRegressionTestController> {
    
    //create instance of test-controller for HDLRegression
    testController = new HDLRegressionTestController(context);
    return testController;
}
