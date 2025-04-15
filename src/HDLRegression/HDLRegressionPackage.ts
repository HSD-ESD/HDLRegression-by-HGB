
export interface HDLRegressionData 
{
    files: HDLRegressionFile[];
    tests: HDLRegressionTest[];
    [propName: string]: any;
}

export interface HDLRegressionTest {
    testcase_id: number;
    testcase_name: string;
    name: string;
    architecture: string;
    testcase?: string;
    generics?: Record<string, string>; // Optional, since it may not always be present
    hdl_file_name: string;
    hdl_file_path: string;
    hdl_file_lib: string;
    language: "VHDL" | "VERILOG" | "UNKNOWN";
}

export type HDLRegressionTests = HDLRegressionTest[];

export interface HDLRegressionFile 
{
    file_name: string;
    library_name: string;
    is_testbench : boolean;
    [propName: string]: any;
}