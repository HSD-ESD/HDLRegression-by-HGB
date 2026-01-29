//specific imports
import { HDLRegression } from "./HDLRegression";

//general imports
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import exp = require("constants");
import readline = require('readline');
import kill = require('tree-kill');
import { ChildProcess } from "child_process";
import { HDLRegressionFile, HDLRegressionTest } from "./HDLRegressionPackage";

//--------------------------------------------
// module-internal constants
//--------------------------------------------

const cEmptyTest : HDLRegressionTest = {
    testcase_id: 0,
    testcase_name: "",
    name: "",
    architecture: "",
    testcase: "",
    hdl_file_name: "",
    hdl_file_path: "",
    hdl_file_lib: "",
    language: "UNKNOWN"
};

//TestBench-Status-Matcher
const cHDLRegressionTestEnd : RegExp = /Result: (PASS|FAIL)/;
const cHDLRegressionTimedTestEnd : RegExp = /Result: (PASS|FAIL)(?: \((\d+)h:(\d+)m:(\d+)s\))?/;
const cHDLRegressionTestStart: RegExp = /Running: (\S+)\.(\S+)\.(\S+)(?:\.(\S+))?\s+\(test_id: (\d+)\)/;

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

            //execute selected test-cases on console
            if (request.profile?.kind === vscode.TestRunProfileKind.Run)
            {
                //set all selected testcases to "running-mode" for spinning wheel in UI
                await Promise.all(request.include.map(t => this.traverseNode(t, request, run, startNode)));
                await this.RunHDLRegressionTestsShell(request.include[0], request, run);
            }
            //execute selected test-cases in GUI
            else if (request.profile?.kind === vscode.TestRunProfileKind.Debug)
            {
                if (request.include[0].children.size > 0)
                {
                    // read configuration from vscode-settings
                    const multipleGuiTestcases = vscode.workspace
                        .getConfiguration()
                        .get('hdlregression-by-hgb.executeMultipleGuiTestcases') as boolean;

                    if (!multipleGuiTestcases) 
                    {
                        vscode.window.showErrorMessage("Executing multiple testcases in GUI-Mode: disabled!");
                    }
                    else
                    {
                        await this.RunHDLRegressionTestsGUI(request.include[0], request, run);
                    }
                }
                else
                {
                    await this.RunHDLRegressionTestsGUI(request.include[0], request, run);
                }
            }

        } 
        // all testcases should be run
        else {
            
            //get all top-level items (all HDLRegression-scripts)
            const TopLevelItems : vscode.TestItem[] = mapTestItems(this.mTestController.items, item => item); 

            //set all testcases to "enqueued-mode" in UI
            await Promise.all(TopLevelItems.map(t => this.traverseNode(t, request, run, enqueueNode)));

            //execute all test-cases on console
            if (request.profile?.kind === vscode.TestRunProfileKind.Run)
            {
                for(const item of TopLevelItems)
                {
                    //set all selected testcases to "running-mode" for spinning wheel in UI
                    await this.traverseNode(item, request, run, startNode);
                    await this.RunHDLRegressionTestsShell(item, request, run);
                }
            }
            //execute all test-cases in GUI
            else if (request.profile?.kind === vscode.TestRunProfileKind.Debug)
            {
                // read configuration from vscode-settings
                const multipleGuiTestcases = vscode.workspace
                    .getConfiguration()
                    .get('hdlregression-by-hgb.executeMultipleGuiTestcases') as boolean;

                if (!multipleGuiTestcases) 
                {
                    vscode.window.showErrorMessage("Executing all testcases in GUI-Mode: disabled!");
                }
                else
                {
                    for(const item of TopLevelItems)
                    {
                        await this.RunHDLRegressionTestsShell(item, request, run);
                    }
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
        for(const test of tests)
        {
            // get item of library
            const libraryID = getLibraryItemId(hdlregressionScript, test.hdl_file_lib);
            let libraryItem : vscode.TestItem | undefined = scriptItem.children.get(libraryID);

            // create node for library if not existing yet
            if (!libraryItem)
            {
                libraryItem = this.mTestController.createTestItem(libraryID, test.hdl_file_lib);
                scriptItem.children.add(libraryItem);
            }

            // get item of testbench
            const testBenchItemID = getTestBenchItemId(hdlregressionScript, test.hdl_file_lib, test.name);
            let testBenchItem : vscode.TestItem | undefined = libraryItem.children.get(testBenchItemID);
            
            //create node for testbench if not existing yet
            if (!testBenchItem)
            {
                testBenchItem = this.mTestController.createTestItem(testBenchItemID, test.name, vscode.Uri.file(test.hdl_file_path));
                libraryItem.children.add(testBenchItem);
            }

            // get item of architecture
            const testBenchArchitectureID = getArchitectureItemId(hdlregressionScript, test.hdl_file_lib, test.name, test.architecture);
            let testBenchArchitectureItem : vscode.TestItem | undefined = testBenchItem.children.get(testBenchArchitectureID);
            
            //create node for architecture if not existing yet
            if (!testBenchArchitectureItem)
            {
                testBenchArchitectureItem = this.mTestController.createTestItem(testBenchArchitectureID, test.architecture);
                testBenchItem.children.add(testBenchArchitectureItem);
            }

            // it is possible to have a single architecture as testcase without specifying multiple explicit testcases inside the architecture
            if (test.testcase) {
                //create node for testcase
                const testCaseID : string = getTestCaseItemId(hdlregressionScript, test.hdl_file_lib, test.name, test.architecture, test.testcase);
                const testCaseItem : vscode.TestItem = this.mTestController.createTestItem(testCaseID, test.testcase);

                testBenchArchitectureItem.children.add(testCaseItem);
            }
            
        }

        return true;
    }

    private async traverseNode(
        node: vscode.TestItem,
	    request: vscode.TestRunRequest,
	    run: vscode.TestRun,
        callback : (node: vscode.TestItem, run : vscode.TestRun) => void
    ) : Promise<void>
    {
        if (request.exclude?.includes(node)) {
            return;
        }

        if (node.children.size > 0)
        {
            // recurse all children if this is a "suite"
            await Promise.all(mapTestItems(node.children, t => this.traverseNode(t, request, run, callback)));
        }
        else
        {
            callback(node, run);
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

    private async RunHDLRegressionTestsShell(node : vscode.TestItem, request: vscode.TestRunRequest, run: vscode.TestRun) : Promise<void>
    {
        //extract HDLRegressionScript path
        const HDLRegressionScript = node.id.split('|')[0];

        //Command-Line-Arguments for HDLRegression
        let options = createCommandLineArgumentsForTestRun(node);

        const hdlregressionOptions = vscode.workspace
            .getConfiguration()
            .get('hdlregression-by-hgb.shellOptions');
        if (hdlregressionOptions) {
            options.push(hdlregressionOptions as string);
        }   

        const showExecutionTime = vscode.workspace
            .getConfiguration()
            .get('hdlregression-by-hgb.showExecutionTime') as boolean;

        //variable for referencing output from HDLRegression-process to analyse its output
        let hdlregressionProcess : any;

        //launch HDLRegression-process with given arguments from above
        await this.mHDLRegression.Run(HDLRegressionScript, options, (hdlregression: ChildProcess) => {

            // handle cancellation of test-suite
            let disposable = run.token.onCancellationRequested(() => {
                killProcess(hdlregression);
                this.traverseNode(node, request, run, skipRunningNode);
            });
            this.mContext.subscriptions.push(disposable);

            // append output to testcase
            hdlregression.stdout?.on('data', (data : string) => {
                run.appendOutput(data);
            });
            hdlregression.stderr?.on('data', (data : string) => {
                run.appendOutput(data);
            });

            hdlregressionProcess = hdlregression;

            let currentTestCase : HDLRegressionTest | undefined = undefined;
            
            readline
                .createInterface({
                    input: hdlregressionProcess.stdout,
                    terminal: false,
                })
                .on('line', (line: string) => {

                    const regressionTest = cHDLRegressionTestStart.exec(line);
                    if(regressionTest)
                    {
                        // init with default values
                        currentTestCase = cEmptyTest;
                        // fill in parsed values
                        currentTestCase.hdl_file_lib = regressionTest[1];
                        currentTestCase.name = regressionTest[2];
                        currentTestCase.architecture = regressionTest[3];
                        currentTestCase.testcase = regressionTest[4];
                        currentTestCase.testcase_id = parseInt(regressionTest[5]);
                    }
                    
                    if(currentTestCase)
                    {
                        //check for success/failure of TestCase
                        this.MatchTestCaseStatus(line, currentTestCase, node, run, HDLRegressionScript, showExecutionTime);
                    }

                });
        }).finally(() => {
            hdlregressionProcess = 0;
        })
        .catch((err) => {
            run.failed(node, new vscode.TestMessage("Error in Execution of " + HDLRegressionScript));
            node.busy = false;
        });

    }

    private async RunHDLRegressionTestsGUI(node : vscode.TestItem, request: vscode.TestRunRequest, run: vscode.TestRun) : Promise<void>
    {
        //extract HDLRegressionScript path
        const HDLRegressionScript = node.id.split('|')[0];

        //Command-Line-Arguments for HDLRegression
        let options = createCommandLineArgumentsForTestRun(node);
        // append gui-setting to arguments
        options.push("-g");

        const hdlregressionOptions = vscode.workspace
            .getConfiguration()
            .get('hdlregression-by-hgb.guiOptions');
        if (hdlregressionOptions) {
            options.push(hdlregressionOptions as string);
        }   

        //launch HDLRegression-process with given arguments from above
        await this.mHDLRegression.Run(HDLRegressionScript, options, (hdlregression : ChildProcess) => {
            // handle cancellation of test-suite
            let disposable = run.token.onCancellationRequested(() => {
                killProcess(hdlregression);
                this.traverseNode(node, request, run, skipRunningNode);
            });
            this.mContext.subscriptions.push(disposable);

            // append output to testcase
            hdlregression.stdout?.on('data', (data : string) => {
                run.appendOutput(data);
            });
            hdlregression.stderr?.on('data', (data : string) => {
                run.appendOutput(data);
            });
        });
    }

    private MatchTestCaseStatus(line : string, testCase : HDLRegressionTest, node : vscode.TestItem, run : vscode.TestRun, hdlregressionScript : string, showExecutionTime : boolean) : void
    {
        let testCaseMatcher : RegExp = cHDLRegressionTestEnd;
        if (showExecutionTime) {
            testCaseMatcher = cHDLRegressionTimedTestEnd;
        }

        //check for pass or fail
        const result = testCaseMatcher.exec(line);
        if (result) {

            const status = result[1];
            let executionTime : number | undefined = undefined;

            if (showExecutionTime) {
                const hours = parseInt(result[2]);
                const minutes = parseInt(result[3]);
                const seconds = parseInt(result[4]);

                executionTime = (hours * 3600 + minutes * 60 + seconds) * 1000;
            }

            //get related test-item
            const itemId = getTestCaseItemId(hdlregressionScript, testCase.hdl_file_lib, testCase.name, testCase.architecture, testCase.testcase);
            const item = this.findNode(itemId, node);

            if (!item) {
                return;
            }

            item.busy = false;

            //evaluate result
            if(result[1] === 'PASS')
            {
                if(item) 
                { 
                    run.passed(item, executionTime); 
                }
            }
            else
            {
                if(item) 
                { 
                    run.failed(item, new vscode.TestMessage(result[2] + " failed!"), executionTime); 
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

function killProcess(process : ChildProcess) : void 
{
    kill(process.pid);
}

function getTestCaseItemId(scriptPath : string, libraryName : string, testBenchName : string, architectureName : string, testcaseName? : string) : string
{
    const architectureItemId : string = getArchitectureItemId(scriptPath, libraryName, testBenchName, architectureName);
    let testCaseItemId : string = architectureItemId; 
    if (testcaseName) {
        testCaseItemId = testCaseItemId.concat(".", testcaseName);
    }
    return testCaseItemId;
}

function getLibraryItemId(scriptPath : string, libraryName : string) : string 
{
    const libraryItemId : string = scriptPath.concat("|", libraryName);
    return libraryItemId;
}

function getTestBenchItemId(scriptPath : string, libraryName : string, testBenchName : string) : string 
{
    const libraryItemId : string = getLibraryItemId(scriptPath, libraryName);
    const testBenchItemId : string = libraryItemId.concat(".", testBenchName);
    return testBenchItemId;
}

function getArchitectureItemId(scriptPath : string, libraryName : string, testBenchName : string, architectureName : string) : string {
    const testBenchItemId : string = getTestBenchItemId(scriptPath, libraryName, testBenchName);
    const architectureItemId : string = testBenchItemId.concat(".", architectureName);
    return architectureItemId;
}

function skipRunningNode(node : vscode.TestItem, run : vscode.TestRun) : void 
{
    if (node.busy)
    {
        node.busy = false;
        run.skipped(node);
    }
}

function startNode(node : vscode.TestItem, run : vscode.TestRun) : void 
{
    run.started(node);
    node.busy = true;
}

function enqueueNode(node : vscode.TestItem, run : vscode.TestRun) : void 
{
    run.enqueued(node);
}

function createCommandLineArgumentsForTestRun(node : vscode.TestItem) : string[] {
    //extract HDLRegressionScript path
    const HDLRegressionScript = node.id.split('|')[0];

    let command : string = "";

    //wildcard-appendix
    let testCaseWildCard : string = "";

    //check for top-level node
    if(node.parent)
    {
        command = "-tc";    // selected testcase/s

        const fullTestCaseId = node.id.split('|')[1];
        const testcaseComponents = fullTestCaseId.split('.');
        const testcaseComponentsWithoutLibrary = testcaseComponents.slice(1);
        const libraryName = testcaseComponents[0];
        const fullTestCaseIdWithoutLibrary = testcaseComponentsWithoutLibrary.join('.');

        // this prefix is always needed, no matter which tests (single test, testsuite, ...) are run
        testCaseWildCard = libraryName + ":";

        //check, if this node is a test-suite
        if(node.children.size > 0)
        {
            if (testcaseComponentsWithoutLibrary.length > 0) {
                testCaseWildCard += fullTestCaseIdWithoutLibrary + ".*";
            } else {
                // execute all testcases of library
                testCaseWildCard += "*";
            }
        }
        // node is a bottom-level-node
        else {
            testCaseWildCard += fullTestCaseIdWithoutLibrary;
        }
    }
    else {
        command = "-fr";    // full regression
    }

    //Command-Line-Arguments for HDLRegression
    let options = [command, testCaseWildCard, "--noColor"];

    return options;
}
