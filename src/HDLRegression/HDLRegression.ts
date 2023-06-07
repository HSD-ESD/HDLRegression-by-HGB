//use
'use strict';

//specific imports

//general imports
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChildProcess, spawn } from 'child_process';
import kill = require('tree-kill');
import readline = require('readline');
import uuid = require('uuid-random');
import { HDLRegressionData, HDLRegressionFile, HDLRegressionTest } from './HDLRegressionPackage';

//module-internal constants
const cHDLRegressionLtcMatcher : RegExp = /^TC:(\d+)\s+-\s+(\w+)\.(\w+)\.(\w+)/;
const cHDLRegressionLibraryMatcher : RegExp = /\|\-\-\[(\d+)\]\-\-\s+(.+)/;
const cHDLRegressionFileMatcher = /\|--\[\d+\]--\s*(.+?)(?:\(TB\))?$/;


export class HDLRegression {

    //--------------------------------------------
	//Private Members
	//--------------------------------------------
    private mOutputChannel : vscode.OutputChannel;

    //--------------------------------------------
	//Public Methods
	//--------------------------------------------
    public constructor() {
        this.mOutputChannel = vscode.window.createOutputChannel("HDLRegressionByHGB.HDLRegression");
    }

    public async FindHDLRegressionScripts(
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<string[]> {

        const HDLRegressionScriptName : string | undefined = vscode.workspace.getConfiguration().get("hdlregression-by-hgb.scriptname");
        let hdlRegressionScripts: string[] = new Array<string>();

        if(!HDLRegressionScriptName)
        {
            return hdlRegressionScripts;
        }

        let results = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, `**/${HDLRegressionScriptName}`),
        );
        hdlRegressionScripts = results.map((file) => {
            return file.fsPath;
        });

        return hdlRegressionScripts;
    }

    public async Run(
        hdlregressionScript: string,
        hdlregressionArgs: string[],
        hdlregressionProcess: (hdlregression: ChildProcess) => void = () => {}
    ): Promise<string> {
        try{

            return new Promise((resolve, reject) => {
                if (!this.GetWorkspaceRoot()) {
                    return reject(new Error('Workspace root not defined.'));
                } else if (!hdlregressionScript) {
                    return reject(
                        new Error('Unable to determine path of HDLRegression run script.')
                    );
                } else if (!fs.existsSync(hdlregressionScript)) {
                    return reject(Error(`HDLRegression script ${hdlregressionScript} does not exist.`));
                }
                const python = vscode.workspace
                    .getConfiguration()
                    .get('hdlregression-by-hgb.python') as string;
                const args = ['"' + hdlregressionScript + '"'].concat(hdlregressionArgs);
                this.mOutputChannel.appendLine('');
                this.mOutputChannel.appendLine('===========================================');
                this.mOutputChannel.appendLine('Running HDLRegression: ' + python + ' ' + args.join(' '));
                let hdlregression = spawn(python, args, {
                    cwd: path.dirname(hdlregressionScript),
                    shell: true,
                });
                hdlregression.on('close', (code) => {
                    if (code === 0) {
                        this.mOutputChannel.appendLine('\nFinished with exit code 0');
                        resolve(code.toString());
                    } else {
                        let msg = `HDLRegression returned with non-zero exit code (${code}).`;
                        this.mOutputChannel.appendLine('\n' + msg);
                        reject(new Error(msg));
                    }
                });
                hdlregressionProcess(hdlregression);
                hdlregression.stdout.on('data', (data: string) => {
                    this.mOutputChannel.append(data.toString());
                });
                hdlregression.stderr.on('data', (data: string) => {
                    this.mOutputChannel.append(data.toString());
                });

            });
        }
        catch(error)
        {
            console.log(error);
        }

        return "";
    }

    public async GetHDLRegressionData(hdlregressionScript : string): Promise<HDLRegressionData> 
    {

        const testcases : HDLRegressionTest[] = await this.GetHDLRegressionTestcases(hdlregressionScript);
        const files : HDLRegressionFile[] = await this.GetHDLRegressionFiles(hdlregressionScript);
        
        const data : HDLRegressionData =
        {
            files : files,
            tests : testcases
        };

        return data;
    }


    public async GetHDLRegressionTestcases(hdlregressionScript : string): Promise<HDLRegressionTest[]> {
        
        const options = ['-ltc'];

        let HDLRegressionTestCases : HDLRegressionTest[] = new Array<HDLRegressionTest>();
        let hdlregressionProcess : any;

        await this.Run(hdlregressionScript, options, (hdlregression: ChildProcess) => {

            hdlregressionProcess = hdlregression;
            
            readline
                .createInterface({
                    input: hdlregressionProcess.stdout,
                    terminal: false,
                })
                .on('line', (line: string) => 
                {
                    const HDLRegressionTestCase = cHDLRegressionLtcMatcher.exec(line);

                    if(HDLRegressionTestCase)
                    {
                        const testCaseID = parseInt(HDLRegressionTestCase[1]);
                        const testBench = HDLRegressionTestCase[2];
                        const testCaseArchitecture = HDLRegressionTestCase[3];
                        const testCaseName = HDLRegressionTestCase[4];

                        const regressionTestCase : HDLRegressionTest =
                        {
                            testcase_id : testCaseID,
                            testbench : testBench,
                            architecture : testCaseArchitecture,
                            name : testCaseName
                        };

                        HDLRegressionTestCases.push(regressionTestCase);
                    }
                });
            
            });
            
        return HDLRegressionTestCases;
    }

    public async GetHDLRegressionFiles(hdlregressionScript : string): Promise<HDLRegressionFile[]> {
        
        const options = ['-lco'];

        let HDLRegressionFiles : HDLRegressionFile[] = new Array<HDLRegressionFile>();
        let hdlregressionProcess : any;

        let currentLibrary : string;

        await this.Run(hdlregressionScript, options, (hdlregression: ChildProcess) => {

            hdlregressionProcess = hdlregression;
            
            readline
                .createInterface({
                    input: hdlregressionProcess.stdout,
                    terminal: false,
                })
                .on('line', (line: string) => 
                {
                    const HDLRegressionLibrary = cHDLRegressionLibraryMatcher.exec(line);

                    if(HDLRegressionLibrary)
                    {
                        currentLibrary = HDLRegressionLibrary[1];
                    }

                    const HDLRegressionFile = cHDLRegressionFileMatcher.exec(line);

                    if(HDLRegressionFile)
                    {
                        const fileName = HDLRegressionFile[1].trim();
                        const isTestbench = HDLRegressionFile[2] === 'TB';

                        const regressionFile : HDLRegressionFile =
                        {
                            file_name: fileName,
                            library_name: currentLibrary,
                            is_testbench: isTestbench
                        };

                        HDLRegressionFiles.push(regressionFile);
                    }
                });
            
            });
            
        return HDLRegressionFiles;
    }


    public GetWorkspaceRoot(): string | undefined {
        const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];
        let wsRoot: string | undefined = undefined;
        if (workspaceFolder) {
            wsRoot = workspaceFolder.uri.fsPath;
        }
        return wsRoot;
    }

}
