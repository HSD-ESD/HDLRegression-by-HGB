//specific imports
import { HDLRegression } from "./HDLRegression";

//general imports
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import exp = require("constants");
import readline = require('readline');
import { ChildProcess } from "child_process";
import { HDLRegressionFile, HDLRegressionTest } from "./HDLRegressionPackage";

//--------------------------------------------
// module-internal constants
//--------------------------------------------

//TestBench-Status-Matcher
const cHDLRegressionTestEnd : RegExp = /Result: (PASS|FAIL)/;
const cHDLRegressionTestStart : RegExp = /Running: (\S+)\.(\S+)\.(\S+)\.(\S+)\s+\(test_id: (\d+)\)/;

export class HDLRegressionTestController {

    //--------------------------------------------
	//Private Members
	//--------------------------------------------

    //vs-code-members
    private mContext : vscode.ExtensionContext;
    private mOutputChannel : vscode.OutputChannel;
    private mDiagnosticCollection : vscode.DiagnosticCollection;

    //specific members
    private mTestController : vscode.TestController;
    private mRunProfile : vscode.TestRunProfile;
    private mDebugProfile : vscode.TestRunProfile;

    private mWorkSpacePath : string = "";
    private mHDLRegression : HDLRegression;

    //--------------------------------------------
	//Public Methods
	//--------------------------------------------
    public constructor(context : vscode.ExtensionContext) {

        //initialize vs-code-members
        this.mContext = context;
        this.mOutputChannel = vscode.window.createOutputChannel("HDLRegressionByHGB.TestController");
        this.mDiagnosticCollection = vscode.languages.createDiagnosticCollection('HDLRegressionByHGB.HDLRegressionErrors');

        //initialize specific members
        this.mHDLRegression = new HDLRegression();

        //get workspace-path of extension
        const workSpacePath = this.mHDLRegression.GetWorkspaceRoot(); 
        if(workSpacePath) { this.mWorkSpacePath = workSpacePath; }

        this.HandleFileEvents();

        // create TestController for HDLRegression
        this.mTestController = vscode.tests.createTestController('hdlregression-test-controller', 'HDLRegression TestController');
        this.mContext.subscriptions.push(this.mTestController);

        //create profile for running Tests
        this.mRunProfile = this.mTestController.createRunProfile('Run', vscode.TestRunProfileKind.Run, request => this.RunTests(request), true);
        //create profile for debugging tests
        this.mDebugProfile = this.mTestController.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, request => this.RunTests(request), true);

        //resolve-handler for initial loading of testcases in User-Interface
        this.mTestController.resolveHandler = load => {
            this.LoadTests();
        };

        //refresh-handler for manual refreshing of testcases in User-Interface
        this.mTestController.refreshHandler = load => {
            this.LoadTests();
        };
    }

    public getContext() : vscode.ExtensionContext 
    {
        return this.mContext;
    }

    public async RunTests(request : vscode.TestRunRequest) : Promise<void>
    {
        const run : vscode.TestRun = this.mTestController.createTestRun(request);

        this.mDiagnosticCollection.clear();

        //specific selection of elements from User-Interface should be run
        if (request.include) {

            //set all selected testcases to "running-mode" for spinning wheel in UI
            await Promise.all(request.include.map(t => this.runNode(t, request, run)));

            //execute selected test-cases on console
            if (request.profile?.kind === vscode.TestRunProfileKind.Run)
            {
                await this.RunHDLRegressionTestsShell(request.include[0], run);
            }
            //execute selected test-cases in GUI
            else if (request.profile?.kind === vscode.TestRunProfileKind.Debug)
            {
                await this.RunHDLRegressionTestsGUI(request.include[0], run);
            }

        } 
        // all testcases should be run
        else {
            
            //get all top-level items (all HDLRegression-scripts)
            const TopLevelItems : vscode.TestItem[] = mapTestItems(this.mTestController.items, item => item); 

            //set all testcases to "enqueued-mode" in UI
            Promise.all(TopLevelItems.map(t => this.enqueueNode(t, request, run)));

            //execute all test-cases on console
            if (request.profile?.kind === vscode.TestRunProfileKind.Run)
            {
                for(const item of TopLevelItems)
                {
                    //set all selected testcases to "running-mode" for spinning wheel in UI
                    await this.runNode(item, request, run);
                    await this.RunHDLRegressionTestsShell(item, run);
                }
            }
            //execute all test-cases in GUI
            else if (request.profile?.kind === vscode.TestRunProfileKind.Debug)
            {
                for(const item of TopLevelItems)
                {
                    await this.RunHDLRegressionTestsGUI(item, run);
                }
            }
        }
        
        run.end();
    }

    public async LoadTests() : Promise<void>
    {
        //Find all HDLRegression-Scripts in WorkSpace
        const HDLRegressionScripts : string[] = await this.mHDLRegression.FindScripts((vscode.workspace.workspaceFolders || [])[0]);

        //delete all old items
        for(const [id,item] of this.mTestController.items)
        {
            this.mTestController.items.delete(id);
        }

        //load all HDLRegression-Scripts parallely
        await Promise.all(HDLRegressionScripts.map((regressionScript) => this.LoadHDLRegressionScript(regressionScript)));
    }

    private async LoadHDLRegressionScript(hdlregressionScript : string) : Promise<boolean>
    {
        // get testcases for HDLRegression-Script
        const tests : HDLRegressionTest[] = await this.mHDLRegression.GetTestcases(hdlregressionScript);

        //relative path from workspace-folder to HDLRegression-Script 
        const hdlregressionScriptPath : string = path.relative(this.mWorkSpacePath, hdlregressionScript);

        //create test-item for selected 
        let scriptItem : vscode.TestItem = this.mTestController.createTestItem(hdlregressionScript, hdlregressionScriptPath, vscode.Uri.file(hdlregressionScript));
        this.mTestController.items.add(scriptItem);

        // add all testcases to specified HDLRegression-Script-testcase-item
        for(const testcase of tests)
        {
            // get item of testbench
            const testBenchID = hdlregressionScript.concat("|", testcase.testbench);
            let testBenchItem : vscode.TestItem | undefined = scriptItem.children.get(testBenchID);
            
            //create node for testbench if not existing yet
            if (!testBenchItem)
            {
                testBenchItem = this.mTestController.createTestItem(testBenchID, testcase.testbench);
                scriptItem.children.add(testBenchItem);
            }

            // get item of architecture
            const testBenchArchitectureID = hdlregressionScript.concat("|", testcase.testbench, ".", testcase.architecture);
            let testBenchArchitectureItem : vscode.TestItem | undefined = testBenchItem.children.get(testBenchArchitectureID);
            
            //create node for architecture if not existing yet
            if (!testBenchArchitectureItem)
            {
                testBenchArchitectureItem = this.mTestController.createTestItem(testBenchArchitectureID, testcase.architecture);
                testBenchItem.children.add(testBenchArchitectureItem);
            }

            //create node for testcase
            const testCaseID : string = hdlregressionScript.concat("|", testcase.testbench, ".", testcase.architecture, ".", testcase.name, "|", testcase.testcase_id.toString());
            const testCaseItem : vscode.TestItem = this.mTestController.createTestItem(testCaseID, testcase.name);

            testBenchArchitectureItem.children.add(testCaseItem);
        }

        return true;
    }

    
    private async runNode(
        node: vscode.TestItem,
	    request: vscode.TestRunRequest,
	    run: vscode.TestRun,
    ): Promise<void> 
    {
        // check for filter on test
        if (request.exclude?.includes(node)) {
            return;
        }

        if (node.children.size > 0) 
        {  
            // recurse and run all children if this is a "suite"
            Promise.all(mapTestItems(node.children, t => this.runNode(t, request, run)));
        }
        else
        {
            //bottom-item was reached -> set this testcase to mode "running"
            //(spinning wheel in User-Interface)
            run.started(node);
        }
    }

    private async enqueueNode(
        node: vscode.TestItem,
	    request: vscode.TestRunRequest,
	    run: vscode.TestRun,
    ): Promise<void> 
    {
        // check for filter on test
        if (request.exclude?.includes(node)) {
            return;
        }

        if (node.children.size > 0) 
        {
            // recurse and enqueue all children if this is a "suite"
            Promise.all(mapTestItems(node.children, t => this.enqueueNode(t, request, run)));
        }
        else
        {
            run.enqueued(node);
        }
    }

    private findNode(itemId: string, node: vscode.TestItem): vscode.TestItem | undefined 
    {
        if (node.id === itemId) {
          return node;
        }
      
        if (node.children.size > 0) {
          for (const [id, testNode] of node.children) {
            const result = this.findNode(itemId, testNode);
            if (result) {
              return result;
            }
          }
        }
      
        return undefined;
    }

    private async RunHDLRegressionTestsShell(node : vscode.TestItem, run: vscode.TestRun) : Promise<void>
    {
        //extract HDLRegressionScript path
        const HDLRegressionScript = node.id.split('|')[0];

        let testCaseWildCard : string = "";
        let command : string = "";

        //check for top-level node
        if(node.parent)
        {
            command = "-tc";

            //check, if this node is a bottom-level node
            if(node.children.size === 0)
            {
                testCaseWildCard = node.id.split('|')[2];
            }
            else
            {
                testCaseWildCard = node.id.split('|')[1];
            }
        }

        //Command-Line-Arguments for HDLRegression
        let options = [command, testCaseWildCard, "--noColor"];

        const hdlregressionOptions = vscode.workspace
            .getConfiguration()
            .get('hdlregression-by-hgb.shellOptions');
        if (hdlregressionOptions) {
            options.push(hdlregressionOptions as string);
        }   

        //variable for referencing output from HDLRegression-process to analyse its output
        let hdlregressionProcess : any;

        //launch HDLRegression-process with given arguments from above
        await this.mHDLRegression.Run(HDLRegressionScript, options, (hdlregression: ChildProcess) => {

            hdlregressionProcess = hdlregression;

            let currentTestCase : HDLRegressionTest | undefined;
            
            readline
                .createInterface({
                    input: hdlregressionProcess.stdout,
                    terminal: false,
                })
                .on('line', (line: string) => {

                    const regressionTest = cHDLRegressionTestStart.exec(line);
                    if(regressionTest)
                    {
                        currentTestCase = 
                        {
                            testbench : regressionTest[2],
                            architecture : regressionTest[3],
                            name : regressionTest[4],
                            testcase_id : parseInt(regressionTest[5])
                        };
                    }
                    
                    if(currentTestCase)
                    {
                        //check for success/failure of TestCase
                        this.MatchTestCaseStatus(line, currentTestCase, node, run, HDLRegressionScript);
                    }

                });
        }).finally(() => {
            hdlregressionProcess = 0;
        })
        .catch((err) => {
            run.failed(node, new vscode.TestMessage("Error in Execution of " + HDLRegressionScript));
        });

    }

    private async RunHDLRegressionTestsGUI(node: vscode.TestItem, run: vscode.TestRun) : Promise<void>
    {
        //extract HDLRegressionScript path
        const HDLRegressionScript = node.id.split('|')[0];

        let testCaseWildCard : string = "";
        let command : string = "";

        //check for top-level node
        if(node.parent)
        {
            command = "-tc";

            //check, if this node is a bottom-level node
            if(node.children.size === 0)
            {
                testCaseWildCard = node.id.split('|')[2];
            }
            else
            {
                testCaseWildCard = node.id.split('|')[1];
            }
        }

        //Command-Line-Arguments for HDLRegression
        let options = [command, testCaseWildCard, "--noColor" ,"-g"];

        const hdlregressionOptions = vscode.workspace
            .getConfiguration()
            .get('hdlregression-by-hgb.guiOptions');
        if (hdlregressionOptions) {
            options.push(hdlregressionOptions as string);
        }   

        //launch HDLRegression-process with given arguments from above
        await this.mHDLRegression.Run(HDLRegressionScript, options);
    }

    private MatchTestCaseStatus(line : string, testCase : HDLRegressionTest, node : vscode.TestItem, run : vscode.TestRun, hdlregressionScript : string) : void
    {
        //check for pass or fail
        const result = cHDLRegressionTestEnd.exec(line);
        if (result) {

            //get related test-item
            const item = this.findNode(hdlregressionScript + "|" + testCase.testbench + "." + testCase.architecture + "." + testCase.name + "|" + testCase.testcase_id.toString(), node);

            //evaluate result
            if(result[1] === 'PASS')
            {
                if(item) 
                { 
                    run.passed(item); 
                }
            }
            else
            {
                if(item) 
                { 
                    run.failed(item, new vscode.TestMessage(result[2] + " failed!")); 
                }
            }
        }

    }

    private async HandleFileEvents() : Promise<void>
    {
        vscode.workspace.onDidCreateFiles((event) => 
        {
            const HDLRegressionScriptName : string | undefined = vscode.workspace.getConfiguration().get("hdlregression-by-hgb.scriptname");
            
            if(HDLRegressionScriptName)
            {
                const IsHDLRegressionScript : boolean = event.files.some((file) => {
                    const filePath = file.fsPath.toLowerCase();
                    return filePath.endsWith(HDLRegressionScriptName);
                });

                if(IsHDLRegressionScript)
                {
                    this.LoadTests();
                }
            }

            
        });

        vscode.workspace.onDidDeleteFiles((event) => 
        {
            const HDLRegressionScriptName : string | undefined = vscode.workspace.getConfiguration().get("hdlregression-by-hgb.scriptname");
            
            if(HDLRegressionScriptName)
            {
                const IsHDLRegressionScript : boolean = event.files.some((file) => {
                    const filePath = file.fsPath.toLowerCase();
                    return filePath.endsWith(HDLRegressionScriptName);
                });

                if(IsHDLRegressionScript)
                {
                    this.LoadTests();
                }
            }
        });

        vscode.workspace.onDidRenameFiles((event) => 
        {
            const HDLRegressionScriptName : string | undefined = vscode.workspace.getConfiguration().get("hdlregression-by-hgb.scriptname");
            
            if(HDLRegressionScriptName)
            {
                const IsHDLRegressionScript : boolean = event.files.some((file) => {
                    const newFilePath = file.newUri.fsPath.toLowerCase();
                    const oldFilePath = file.oldUri.fsPath.toLowerCase();
                    return newFilePath.endsWith(HDLRegressionScriptName) || oldFilePath.endsWith(HDLRegressionScriptName);
                });

                if(IsHDLRegressionScript)
                {
                    this.LoadTests();
                    
                }
            }
        });
    }

}


//--------------------------------------------
//Helper Methods
//--------------------------------------------

// Small helper that works like "array.map" for children of a test collection
const mapTestItems = <T>(items: vscode.TestItemCollection, mapper: (t: vscode.TestItem) => T): T[] => {
	const result: T[] = [];
	items.forEach(t => result.push(mapper(t)));
	return result;
};
