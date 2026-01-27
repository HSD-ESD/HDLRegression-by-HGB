# HDLRegressionByHGB

HDLRegressionByHGB is a Visual Studio Code extension that makes it easy to debug and run [HDLRegression](https://github.com/HDLUtils/hdlregression) testcases from the sidebar of VS-Code. 
This Extension is maintained by Jakob Jungreuthmayer at [University of Applied Sciences Upper Austria - Campus Hagenberg](https://www.fh-ooe.at/campus-hagenberg/studiengaenge/bachelor/hardware-software-design/). 

## Features
- List all HDLRegression testcases from multiple regression-scripts
- Run HDLRegression-testcases 
- Debug HDLRegression testcases in GUI mode
- Go-To-Source: Jump to the run script
- Parallel execution of testcases

![UI example](/img/screenshot.png?raw=true)

### Usage
1. Make sure that HDLRegression is installed (e.g. using ```python setup.py build``` and ```python setup.py develop``` )
2. Open a folder that contains a regression script (set your preferred script-name in extension-settings)
3. Open any HDL or python file to activate the extension
4. Open the Testing-SideViewContainer on the left menu bar
5. All Testcases should be displayed. From here, you can:
    - Press the run button to run a unit test in background
    - Press the debug button to run a test in GUI mode

### Requirements
- HDLRegression version 1.4.0 or higher

## History
This Visual Studio Code extension was made by [Jakob Jungreuthmayer](https://github.com/jakobjung10) 
during his bachelor`s degree at [University of Applied Sciences Upper Austria - Campus Hagenberg](https://www.fh-ooe.at/campus-hagenberg/)

## Contributing
Contributing in the form of code, documentation, feedback, tutorial, ideas or bug reports is very welcome. 

## Maintainers: 
- since 2023: [Jakob Jungreuthmayer](https://github.com/jakobjung10)

## Configuration

The following configuration properties are available:

Property                                                | Description
--------------------------------------------------------|---------------------------------------------------------------
`"hdlregression-by-hgb.scriptname"`                     | consistent script-name of all regression-scripts
`hdlregression-by-hgb.python`                           | Path to python executable.
`hdlregression-by-hgb.shellOptions`                     | HDLRegression command line options when running tests.
`hdlregression-by-hgb.guiOptions`                       | HDLRegression command line options when running GUI (-g should not be added here).
`hdlregression-by-hgb.showExecutionTime`                | Display Execution-Time for every testcase
`hdlregression-by-hgb.executeMultipleGuiTestcases`      | Executing multiple GUI-Testcases at once

## Related Projects
- VUnit is an alternative to HDLRegression. Use [VUnitByHGB](https://github.com/HSD-ESD/VUnit-by-HGB)to run VUnit tests from the VS-Code sidebar.

## License

This extension is published under the [GNU GPL license](/LICENSE).
