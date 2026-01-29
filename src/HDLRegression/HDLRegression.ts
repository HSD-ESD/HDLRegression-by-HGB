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
import { HDLRegressionData, HDLRegressionFile, HDLRegressionTest, HDLRegressionTests } from './HDLRegressionPackage';

//module-internal constants
const cHDLRegressionLtcMatcher : RegExp = /^TC:(\d+)\s+-\s+(\w+)\.(\w+)\.(\w+)/;
const cHDLRegressionLibraryMatcher : RegExp = /\|\-\-\[(\d+)\]\-\-\s+(.+)/;
const cHDLRegressionFileMatcher = /\|---\s(.+?)(?:\.(\w+))?$/;


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

    public async FindScripts(
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

    public async GetData(hdlregressionScript : string): Promise<HDLRegressionData> 
    {

        const testcases : HDLRegressionTest[] = await this.GetTestcases(hdlregressionScript);
        const files : HDLRegressionFile[] = await this.GetFiles(hdlregressionScript);
        
        const data : HDLRegressionData =
        {
            files : files,
            tests : testcases
        };

        return data;
    }

    public async GetTestcases(hdlregressionScript : string): Promise<HDLRegressionTest[]> {

        const scriptDir = path.dirname(hdlregressionScript);
        const testcasesJsonPath = path.join(scriptDir, `${uuid()}.json`);
        
        const options = [`-etj ${testcasesJsonPath}`];

        let HDLRegressionTests : HDLRegressionTest[] = [];
        let hdlregressionProcess : any;

        await this.Run(hdlregressionScript, options)
        .catch((err) => {
            console.log(err);
        });

        try {
            HDLRegressionTests = JSON.parse(fs.readFileSync(testcasesJsonPath, 'utf-8'));
            fs.unlinkSync(testcasesJsonPath);
        } catch(err) {
            console.log(err);
        }   
            
        return HDLRegressionTests;
    }

    public async GetFiles(hdlregressionScript : string): Promise<HDLRegressionFile[]> {
        
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
                        currentLibrary = HDLRegressionLibrary[2].trim();
                    }

                    const HDLRegressionFile = cHDLRegressionFileMatcher.exec(line);

                    if(HDLRegressionFile)
                    {
                        let fileName : string = HDLRegressionFile[1].trim();
                        const isTestbench : boolean = HDLRegressionFile[1].includes("(TB)");
                        fileName = isTestbench ? fileName.replace("(TB)", "").trim() : fileName;

                        const regressionFile : HDLRegressionFile =
                        {
                            file_name: fileName,
                            library_name: currentLibrary,
                            is_testbench: isTestbench
                        };

                        HDLRegressionFiles.push(regressionFile);
                    }
                });
            
        })
        .catch((err) => {
            console.log(err);
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
